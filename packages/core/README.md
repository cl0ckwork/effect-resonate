# @effect-resonate/core

Use [Effect](https://effect.website/) services, typed errors, and Layers with
[Resonate](https://resonatehq.io/) durable execution.

The [Resonate TypeScript documentation](https://docs.resonatehq.io/develop/typescript)
covers orchestration and durability. This package keeps the async SDK's names
and behavior while adapting calls and resources to Effect:

- SDK Promises and throwable synchronous methods become lazy `Effect`s with a
  typed `ResonateSdkError` channel.
- `run`, `rpc`, and `get` still return handles; `handle.result()` and
  `handle.done()` are separate Effects.
- `promises.*` and `schedules.*` retain the upstream namespaces and records.
- The client lifecycle is a scoped Layer.
- Typed workflows and steps add schema-aware overloads; raw SDK calls remain
  available.

Use each runtime for the work it owns:

- Resonate owns durable orchestration, replay, timers, and distributed calls.
- Effect owns application effects, typed errors, dependency injection, resources, tracing, and integrations.
- Workflow and step definitions are inert, schema-first durable contracts.
- `toLayer` supplies implementations while preserving ordinary Effect service requirements.
- Service-free codecs validate and transform wrapper-owned values at typed
  workflow, step, and external-promise boundaries. Raw SDK values and original
  thrown errors remain upstream-owned.

## Install

Install core with Effect and the Resonate SDK:

```sh
pnpm add @effect-resonate/core effect @resonatehq/sdk
```

A client needs a network provider. For PostgreSQL, also install `pg` and use
`PostgresNetwork` from `@resonatehq/sdk/postgres`, described below. The SDK
declares `pg` as an optional peer; applications that use another network
provider do not need it.

## PostgreSQL network

Pass a fresh SDK `PostgresNetwork` through `ResonateNetwork.layer`. Set
`DATABASE_URL` to a PostgreSQL connection string; Effect Config reports a
missing variable when the Layer is acquired:

```ts
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"
import { PostgresNetwork } from "@resonatehq/sdk/postgres"
import { Config, Effect, Layer, Redacted } from "effect"

const NetworkLive = Layer.unwrap(
  Config.Redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      ResonateNetwork.layer(
        () =>
          new PostgresNetwork({
            connectionString: Redacted.value(url),
            group: "workers"
          })
      )
    )
  )
)

const ClientLive = ResonateClient.layer({ drainTimeout: "30 seconds" }).pipe(
  Layer.provide(NetworkLive)
)
```

The factory constructs a fresh SDK network for each client acquisition. Core
owns initialization, readiness, and shutdown, including cleanup after partial
acquisition. The SDK owns its PostgreSQL configuration, errors, diagnostics,
logging, and retry behavior.

### Database setup

Provision the Resonate PostgreSQL schema and the `pg_cron` extension before
starting a client. Core does not run migrations or create database objects.
Follow the setup instructions for the version of the
[Resonate TypeScript SDK](https://docs.resonatehq.io/develop/typescript) in use.
The [PostgreSQL example](../../examples/postgres/README.md) shows a local setup
with pinned SQL fixtures; those fixtures are not production migrations.

## Durable contract guidance

Workflow and step definitions are versioned persisted contracts. Use
`Step.evolve` or `Workflow.evolve` when the input, success, failure, observable
side effects, or durable workflow composition changes. Keep implementations
for all versions that retained or in-flight executions may still call. A
definition group is a flat, immutable registry of those contracts; supplying
its handler Layers to `ResonateClient.layer` makes registration closed and
validated before delivery begins.

Root execution IDs identify logical invocations. Reusing an ID does not start a
new invocation with different input or a different contract: Resonate retains
the first durable record, and typed calls check the stored definition identity.
Choose IDs and retention policy accordingly.

Resonate owns retries and replay. A process can fail after an external side
effect succeeds but before its result is durably recorded, so retried step
effects should be idempotent where the external system allows it. The async
SDK defaults to no retries; configure retry behavior deliberately. Cancellation
of an Effect waiter does not cancel the durable execution.

Inside a step implementation, `StepContext` exposes the Resonate step metadata.
Its `id` is stable across delivery attempts for the same durable step; use it
as an idempotency key in the external system. The wrapper cannot make an
external write exactly once on its own.

After a caller loses its connection or cancels a wait, look up the existing
execution by its original ID and definition rather than inventing a new ID:

```ts
const handle = yield * ResonateClient.get("checkout-123", Checkout)
const result = yield * handle.result()
```

`get` is an input-free lookup and does not create an execution. A failed
activation request may already have committed, so retry `run` with the same
ID and contract or use `get` to reconcile its outcome. A durable timeout does
not prove an external side effect was cancelled; a late side effect may still
finish after the timeout result is recorded.

Workflow code should issue durable calls, sleeps, signals, and time/random
operations through its Resonate context. Do not await ordinary I/O or timers
and then issue another durable context operation: the async SDK closes that
context when its pass suspends. Put arbitrary Effect work in registered steps.

## Contract evolution

Persisted contracts never resolve an implicit "latest" version. Evolve a step
when its input, success, failure, or observable side-effect semantics change.
Evolve a workflow when its persisted contract or durable composition changes,
including adding, removing, reordering, or selecting a new version of a step.

```ts
const ChargeCardV1 = Step.make({
  name: "payments.charge",
  version: 1,
  input: ChargeCardInputV1,
  success: ChargeCardSuccessV1,
  failure: ChargeCardFailureV1
})

const ChargeCardV2 = Step.evolve(ChargeCardV1, {
  version: 2,
  input: ChargeCardInputV2,
  success: ChargeCardSuccessV2,
  failure: ChargeCardFailureV2
})
```

`evolve` preserves the stable Resonate function name while creating a new
contract, handler service, and explicit `previous` lineage. It never inherits an
implementation or registers the previous version automatically. Keep every
version needed by retained or in-flight executions in the flat function group.

Implementation-only refactors with identical observable behavior do not require
a new step version. Workflow refactors are version-preserving only when they
produce the same durable call sequence and options.

## Client runtime

The function group is an optional closed contract registry. Implementations and
the provider network remain ordinary Layer dependencies rather than values
inside client configuration.

```ts
const CheckoutFunctions = ResonateFunctions.make(ChargeCardV1, ChargeCardV2, Checkout)

const ResonateLive = ResonateClient.layer({
  functions: CheckoutFunctions,
  drainTimeout: Duration.seconds(30)
}).pipe(Layer.provide([ChargeCardV1Live, ChargeCardV2Live, CheckoutLive, ResonateNetworkLive]))
```

`ResonateClient.layer` validates the complete registry before opening the
network, waits for exact-version registration, and owns graceful shutdown.
`ResonateClient.layer` accepts and forwards every async SDK constructor option
except `network`, which is supplied by the `ResonateNetwork` Layer. Resonate's
own precedence rules still apply: because the Layer provides a network, its
transport owns connection behavior even when `url`, `group`, `token`, or
transport `timeout` are also present in the forwarded client options.

Application code uses module-level accessors. They retrieve the real
`ResonateClient` service from the Effect context and preserve its requirement in
the environment channel:

```ts
const checkout = Effect.gen(function* () {
  const handle = yield* ResonateClient.run("checkout-123", Checkout, { orderId: "order-123" })

  return yield* handle.result()
}).pipe(Effect.provide(ResonateLive))
```

Raw SDK-style registration and invocation remain available with the same names
and positional argument order:

```ts
const raw = Effect.gen(function* () {
  const greet = yield* ResonateClient.register(
    "greet",
    async (_ctx, name: string) => `hello ${name}`
  )
  const handle = yield* greet.run("greet-1", "Luke")
  return yield* handle.result()
})
```

The full async client surface is exposed as `register`, `setDependency`, `run`,
`rpc`, `get`, `schedule`, `options`, `stop`, `promises.*`, and `schedules.*`.
Within workflows, `WorkflowContext` keeps the upstream positional API and eager
`DurablePromise` behavior. It does not insert an Effect runtime into replayed
workflow code.

The drain timeout applies to admitted Effect step handlers. Resonate owns async
workflow frames and resumes unfinished durable work through its normal lease and
replay behavior.
