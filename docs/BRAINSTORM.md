# effect-resonate brainstorm

Status: design exploration, not an API commitment.

## Goal

Build a small Effect-native wrapper around the Resonate TypeScript SDK that preserves Resonate's durable execution model while making application code feel natural in an Effect codebase.

The key boundary is:

```text
Resonate = durable orchestration
Effect    = application effects
```

Resonate should remain responsible for durable sequencing, replay, timers, promises, distributed calls, and workflow state. Effect should remain responsible for service composition, typed errors, resource management, tracing, configuration, Postgres/S3/HTTP clients, and ordinary business logic.

The wrapper should not invent a second workflow interpreter on top of Resonate.

---

## Why target the async Resonate engine

Resonate currently has both generator and async/await execution engines.

Effect also uses generators ergonomically through `Effect.gen`.

Those generators are interpreted by different runtimes and should not be mixed:

```ts
// Effect interprets this generator.
const program = Effect.gen(function* () {
  const db = yield* Database
})
```

```ts
// Resonate's generator engine interprets this generator.
function* workflow(ctx: Context) {
  yield* ctx.sleep(1_000)
}
```

Trying to make the same generator participate in both protocols creates an unnecessary runtime/semantic conflict.

Instead, target:

```ts
import { Resonate } from "@resonatehq/sdk/async"
```

Then the two worlds compose cleanly:

```text
Resonate workflow
  async / await
      |
      +-- ctx.run(step)
      +-- ctx.rpc(step)
      +-- ctx.sleep(...)
      +-- ctx.promise(...)
             |
             v
        Step adapter
             |
             v
       Effect.runPromise
             |
             v
      Effect<A, E, R>
```

Important constraint: arbitrary non-durable awaits should not be introduced inside a durable Resonate workflow. Effect programs containing normal I/O belong behind a Resonate step/activity boundary, not inline between durable Resonate operations.

---

## Proposed programming model

### Step contracts and handler Layers

A `Step` declares a durable contract. Its implementation is supplied separately
as a Layer so workflows and clients can import the contract without importing
worker dependencies.

```ts
const ChargeCard = Step.make({
  name: "payments.charge",
  version: 1,
  input: ChargeCardInput,
  success: ChargeReceipt,
  failure: PaymentDeclined,
})

const ChargeCardLive = ChargeCard.toLayer((input) =>
    Effect.gen(function* () {
      const payments = yield* Payments
      return yield* payments.charge(input)
    }))
```

Persisted execution never selects an implicit latest contract. When a step's
durable I/O or observable side-effect semantics change, create a new contract
that preserves its stable Resonate name:

```ts
const ChargeCardV2 = Step.evolve(ChargeCard, {
  version: 2,
  input: ChargeCardInputV2,
  success: ChargeReceiptV2,
  failure: PaymentDeclinedV2,
})
```

Workflows evolve under the same rule when their durable I/O or step composition
changes. Evolution creates a distinct handler and records its immediate
predecessor, but old versions remain explicitly registered and implemented for
as long as retained or in-flight executions may require them.

Its useful type information is already present in the Effect value:

```text
Effect<ChargeReceipt, PaymentDeclined, Payments>
       |              |                  |
       success        typed failure      requirements
```

A durable step does require input/success/failure codecs because persisted calls
can outlive the TypeScript program that created them. The handler Layer retains
the Effect requirements and the client runtime executes it in the acquired
application Layer graph.

Conceptually:

```ts
resonate.register(
  ChargeCard.name,
  async (_ctx, input) => {
    const exit = await runPromiseExit(ChargeCardHandler(input))
    return encodeStepExit(exit) // one Fail -> Failure; defect/interruption reject
  },
)
```

The real implementation will need an explicit policy for typed Effect failures versus defects. Expected `E` values should remain distinguishable from unexpected defects / infrastructure failures.

### Workflow

A workflow remains ordinary Resonate durable orchestration.

```ts
const Checkout = Workflow.make({
  name: "checkout",
  version: 1,
  input: CheckoutInput,
  success: CheckoutResult,
  failure: CheckoutFailure,
})

const CheckoutLive = Checkout.toLayer(async (ctx, input) => {
    const payment = await ctx.run(ChargeCard, {
      amount: input.total,
      token: input.paymentToken,
    })
    if (Result.isFailure(payment)) {
      return Result.fail(payment.failure)
    }

    await ctx.sleep(1_000)

    const fulfillment = await ctx.rpc(FulfillOrder, {
      orderId: input.orderId,
    })
    if (Result.isFailure(fulfillment)) {
      return Result.fail(fulfillment.failure)
    }

    return Result.succeed({
      payment: payment.success,
      fulfillment: fulfillment.success,
    })
  })
```

The workflow API should stay visually close to Resonate rather than hiding durable operations behind Effect combinators.

### Effect-facing client

Outside the durable workflow world, applications should get an Effect service:

```ts
const program = Effect.gen(function*() {
  const handle = yield* ResonateClient.run(`checkout:${order.id}`, Checkout, input)
  return yield* handle.result()
})
```

`ResonateClient` should be provided through a scoped Layer so Resonate network lifecycle is acquired/released with the application runtime.

---

## Validation: schemas at durable boundaries

Workflow and step inputs/outcomes cross a persisted boundary even when both
ends currently live in one TypeScript application. TypeScript governs local
calls, while service-free codecs govern the durable representation:

```text
Workflow
   |
   +-- ctx.run(StepA, input) --- encode/persist/decode ---> StepA handler
   +-- ctx.run(StepB, input) --- encode/persist/decode ---> StepB handler
```

This catches old or foreign JSON that is structurally durable but invalid for
the exact function version.

### Workflow ingress

Workflow input is the clearest candidate for mandatory or strongly recommended schema validation:

```text
HTTP / CLI / old persisted invocation / other SDK
                    |
                    v
                 unknown
                    |
              Schema.decode
                    |
                    v
             CheckoutInput
                    |
                    v
                workflow
```

This helps catch malformed external input and schema drift in executions that outlive a deployment.

It does **not** solve workflow non-determinism.

### External signals / durable promises

Values supplied later by webhooks, humans, other services, or other runtimes are also real trust boundaries and should support schema validation.

For example:

```ts
const approval = ctx.promise(ApprovalSchema)
```

rather than relying only on a compile-time `ctx.promise<Approval>()` generic when the actual value arrives externally.

### RPC validation

`ctx.rpc` uses the same versioned step contract and codecs as `ctx.run`.
Independent deployment therefore does not require a second validation API.

---

## Schema drift is not determinism

Two distinct durable-execution failure modes should stay conceptually separate.

### Workflow determinism / operation drift

Example:

```text
v1 execution:
  charge
  ship

v2 code:
  ship
  charge
```

Or control flow changes based on non-durable randomness/time.

This is a durable workflow history / replay problem. Resonate owns this class of concern.

### Data/schema drift

Example:

```text
v1 persisted input:
  { userId: "123" }

v2 expects:
  { user: { id: "123" } }
```

TypeScript cannot protect a value loaded from durable storage. Runtime validation can make this failure explicit at ingress.

Schemas help with the second problem, not the first.

---

## Schema vs codec

Avoid treating validation and serialization as the same concern just because Effect Schema can model both.

```text
Schema
  "Is this unknown value valid domain data?"

Codec
  "How does this domain value cross a persistence/network boundary?"
```

Default durable values should be JSON-compatible values.

If a step returns something like:

```ts
{
  createdAt: new Date(),
  ids: new Set(["a", "b"]),
}
```

TypeScript can type-check it, but the value may not round-trip through Resonate persistence with the same semantics.

That serialization problem is expressed directly by the required step codecs:

```ts
Step.make({
  name: "foo",
  version: 1,
  input: FooInput,
  success: FooSuccess,
  failure: FooFailure,
})
```

---

## Network/backend abstraction

Resonate already exposes a `Network` abstraction. The wrapper should reuse it rather than reimplementing protocol behavior.

Keep the network contract in core and provide Effect Layers from separate
provider packages, for example:

```text
ResonateNetwork
  +-- Local
  +-- HTTP / Resonate server
  +-- Postgres
  +-- NATS / future adapters
```

Conceptually:

```ts
const ClientLive = ResonateClient.layer({
  functions: CheckoutFunctions,
  drainTimeout: Duration.seconds(30)
})

const Dev = ClientLive.pipe(Layer.provide([
  CheckoutLive,
  ChargeCardLive,
  LocalNetwork.layer
]))

const Production = ClientLive.pipe(Layer.provide([
  CheckoutLive,
  ChargeCardLive,
  PostgresNetwork.layer({ connectionString })
]))
```

For Postgres, `@effect-resonate/network-postgres` wraps Resonate's official
network implementation. Core must not import that package, expose Postgres
symbols, or branch on provider details. Do not rewrite protocol correctness
logic in `@effect/sql` merely to make the internals look more Effect-like.
The conceptual `LocalNetwork` and other providers follow the same external
package boundary; none is a static constructor on core's service contract.

---

## S3 is not a Resonate backend

Do not conflate the durable execution network/provider with application payload storage.

Postgres can be a Resonate execution backend/network because it supports the protocol semantics Resonate requires.

S3 is better modeled as an application-level payload/artifact store:

```text
Resonate network
  execution state / timers / queues / durable promises

PayloadStore
  application blobs / artifacts / large inputs
      +-- S3
      +-- R2
      +-- Postgres
      +-- filesystem
```

An Effect step can use `PayloadStore` through normal Effect dependency injection and return a small durable reference to the workflow.

---

## Error model

This needs a prototype before locking the API.

Desired semantic distinction:

```text
Expected business failure
  Effect E

Unexpected defect / bug / broken runtime / infrastructure failure
  Resonate execution failure
```

For example, `PaymentDeclined` should not be indistinguishable from a `TypeError` or a broken database connection.

Potential designs:

1. step adapters return an internal `Result<A, E>` envelope for typed failures;
2. workflow `ctx.run(step)` exposes that result explicitly;
3. the outer Effect `ResonateClient` can flatten the result back into the Effect error channel.

Do not finalize until we have exercised failure, retry, replay, RPC, and defect behavior against the real SDK.

---

## Runtime / Layer composition

A major value of the wrapper is letting steps depend on ordinary Effect services:

```ts
Effect<A, E, Database | S3 | HttpClient | Payments>
```

The worker captures the context acquired through ordinary Layer composition and
uses it to execute registered step handler Effects. It does not accept an
application Layer as configuration or build a nested `ManagedRuntime`.

---

## V1 direction

Start small:

1. `ResonateClient` Effect service with scoped lifecycle.
2. Effect Layers for Local, HTTP, and Postgres Resonate networks.
3. Schema-first `Step.make` contracts with Effect handler Layers.
4. Schema-first `Workflow.make` contracts with Resonate async handler Layers.
5. Typed `WorkflowContext.run/rpc` accepting `Step` definitions.
6. Runtime codec validation at every persisted workflow and step boundary.
7. Runtime schema validation for externally supplied durable promise/signal values.
8. JSON-compatible durable values by default.
9. Required service-free codecs with JSON-compatible encoded forms.
10. Tracing/spans around workflow and step execution.
11. Contract/integration tests against Local and Postgres networks.

Explicitly defer:

- writing entire durable workflows as `Effect.gen` programs;
- replacing Resonate's Postgres network with an Effect-specific implementation;
- treating S3 as a Resonate execution backend;
- clever automatic workflow migration/versioning before real use cases exist.

---

## Questions to answer with a prototype

- What exact semantics does Resonate expose when a registered async function throws versus returns a value?
- What is the cleanest mapping from `Effect<A, E, R>` typed failures to durable Resonate results?
- How do Resonate retry policies interact with Effect retry policies, and where should each live?
- Does `ctx.run` versus `ctx.rpc` require different wrapper contracts for serialization/versioning?
- What data does Resonate's codec already preserve beyond plain JSON values?
- Should workflow input schemas be required, or optional with a strongly recommended default?
- How should schema/version migrations be expressed for long-lived workflow inputs?
- What is the minimal useful codec abstraction for `Date`, branded values, binary data, and domain classes?
- How should Resonate tracing correlate with Effect spans?
- How much `R` inference is useful before the API becomes harder to understand than an explicit Layer?

The prototype should answer these questions before the public API is treated as stable.
