# Effect dependency graph for Resonate

Status: architecture direction.

## Principle

`@effect-resonate/core` should use Effect's native service and Layer model rather than introducing a parallel configuration or dependency-injection API.

If something is a dependency, model it as an Effect service requirement.

If something constructs a dependency, model it as a Layer.

The wrapper should not invent a second DI system.

---

## Core relationship

The important relationship is:

```text
PostgresNetwork.layer
        |
        | provides
        v
 ResonateNetwork
        |
        | required by
        v
 ResonateClient.layer
        |
        | provides
        v
 ResonateClient
```

`ResonateClient.layer` should therefore retain a `ResonateNetwork` requirement until the application provides one.

Conceptually:

```ts
Layer.Layer<
  ResonateClient,
  CoreExecutionError,
  ResonateNetwork
>
```

This means the type system expresses the architecture directly: a Resonate client cannot be constructed until a network implementation has been supplied.

---

## ResonateNetwork service

Resonate itself already exposes a `Network` abstraction. The wrapper should translate that abstraction into Effect's service graph rather than replacing it.

Conceptually:

```ts
class ResonateNetwork extends Context.Service<
  ResonateNetwork,
  {
    readonly make: (
      deliver: DeliveryCallback,
    ) => Effect.Effect<CompatibleSdkNetwork, ResonateNetworkError>
  }
>()("@effect-resonate/core/ResonateNetwork") {}
```

`CompatibleSdkNetwork` is derived from the public async `Resonate` constructor
option rather than imported from an unexported SDK module. Provider Layers store
a construction factory and sanitized error mapping, not an already-started or
provider-scoped network. The factory does not register its own finalizer. Core
arms a once-only raw-network finalizer immediately after construction, then
disarms it when ownership transfers to the Resonate instance. Core owns the one
initialization, delivery gate, drain, stop, and release sequence.

Network modules provide implementations of this service.

Examples:

```text
LocalNetwork.layer
HttpNetwork.layer
PostgresNetwork.layer
```

Each provides `ResonateNetwork`.

---

## ResonateClient service

`ResonateClient` is the Effect-facing API used by applications to start, inspect,
settle external promises for, and interact with durable workflows.

Its scoped constructor reads `ResonateNetwork` from the Effect context and owns
the complete runtime/network lifecycle.

Conceptually:

```ts
const make = Effect.gen(function* () {
  const provider = yield* ResonateNetwork
  const runtime = yield* acquireApplicationRuntime
  const gate = yield* makeDeliveryGate(runtime)
  const network = yield* provider.make(gate.deliver)
  const ownership = yield* ownNetworkUntilResonate(network)
  const resonate = yield* initializeOnce(network, gate)
  yield* ownership.transferTo(resonate)

  yield* Effect.addFinalizer(() => releaseInOrder({
    gate,
    resonate,
    runtime,
  }))

  return {
    register: ...,
    run: ...,
    rpc: ...,
    get: ...,
    promises: { get: ..., create: ..., resolve: ..., reject: ..., cancel: ... },
    schedules: { get: ..., create: ..., delete: ... },
    stop: ...,
  }
})

export const layer = Layer.scoped(
  ResonateClient,
  make,
)
```

The resulting Layer still requires `ResonateNetwork`.

The application satisfies that dependency using normal Effect composition.
The drain timeout bounds only the graceful wait. After it expires, core fences
durable completion and requests interruption, then calls `Resonate.stop()` as
the single owner of heartbeat/network shutdown so lease recovery can begin. It
does not dispose the application runtime until admitted adapter promises and
their finalizers settle. A separate once-only network finalizer is armed only
during partial acquisition before the Resonate instance takes ownership.

---

## PostgreSQL example

Direct PostgreSQL execution should look like ordinary Layer composition:

```ts
import { Config, Duration, Effect, Layer } from "effect"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"

const PostgresResonate = ResonateClient.layer({
  functions: CheckoutFunctions,
  drainTimeout: Duration.seconds(30)
}).pipe(Layer.provide([
  CheckoutLive,
  ChargeCardLive,
  PostgresNetwork.layer({
    connectionString: Config.redacted("DATABASE_URL")
  })
]))
```

Application code depends only on the client service:

```ts
const program = Effect.gen(function*() {
  const handle = yield* ResonateClient.run({
    workflow: Checkout,
    id: "checkout-123",
    input
  })
  return yield* handle.result()
}).pipe(
  Effect.provide(PostgresResonate)
)

Effect.runPromise(program)
```

The workflow does not know or care that Postgres is the selected Resonate network.

---

## Other networks are symmetric

Cloud / self-hosted server:

```ts
const CloudResonate =
  ClientLive.pipe(
    Layer.provide(
      HttpNetwork.layer({
        url: Config.string("RESONATE_URL"),
      }),
    ),
  )
```

Local development:

```ts
const LocalResonate =
  ClientLive.pipe(
    Layer.provide(LocalNetwork.layer),
  )
```

The dependency graph is unchanged:

```text
                       ResonateClient
                            |
                     requires Network
                            |
             +--------------+--------------+
             ^              ^              ^
             |              |              |
          Local          HTTP/Cloud     Postgres
          Layer            Layer          Layer
```

Only the provider Layer changes.

---

## Why not `Resonate.layerPostgres(...)`?

A convenience API such as:

```ts
Resonate.layerPostgres(...)
```

would hide the actual dependency relationship and begin creating a second configuration vocabulary alongside Effect's own.

The primitive API should instead expose the graph clearly:

```ts
ClientLive.pipe(
  Layer.provide(PostgresNetwork.layer(...)),
)
```

This has several benefits:

- missing dependencies remain visible to TypeScript;
- network implementations are independently composable;
- application Layers can be assembled using ordinary Effect tools;
- test implementations can replace the network without client-specific branching;
- users learn one dependency model: Effect's.

Convenience constructors can be considered later if real usage shows repeated boilerplate, but they should be implemented in terms of these primitives rather than becoming the primary abstraction.

---

## Compile-time pressure is a feature

If an application constructs `ResonateClient.layer(...)` without providing a
network, the Layer should still retain a `ResonateNetwork` requirement.

Conceptually, this should not typecheck as a fully runnable program:

```ts
program.pipe(
  Effect.provide(ClientLive),
  Effect.runPromise,
)
```

because the graph is incomplete.

The user must complete it:

```ts
const ResonateLive = ClientLive.pipe(Layer.provide([
  CheckoutLive,
  ChargeCardLive,
  PostgresNetwork.layer(...)
]))

program.pipe(
  Effect.provide(ResonateLive),
  Effect.runPromise,
)
```

This is preferable to runtime validation of custom configuration objects because Effect already encodes dependency requirements in the type system.

---

## Step dependencies follow the same rule

This principle should extend beyond the Resonate transport.

A step may naturally require normal application services:

```ts
const ChargeCard = Step.make({
  name: "payments.charge",
  version: 1,
  input: ChargeInput,
  success: ChargeReceipt,
  failure: PaymentDeclined,
})

const ChargeCardLive = ChargeCard.toLayer((input) =>
    Effect.gen(function* () {
      const payments = yield* Payments
      const tracer = yield* Tracer

      return yield* payments.charge(input)
    }))
```

Its Effect already communicates its requirements:

```text
Effect<ChargeReceipt, PaymentDeclined, Payments | Tracer>
```

The step contract remains implementation-free. Its handler Layer communicates
the Effect requirements, and the worker executes it using the application's
supplied Layer graph.

Do not introduce a separate service map such as:

```ts
Resonate.create({
  services: {
    payments,
    database,
    tracer,
  },
})
```

Effect already solves this problem.

---

## Design rule

The relational model for the package is:

```text
Application Effect
      |
      | requires
      v
 ResonateClient
      |
      | constructed from
      v
 ResonateNetwork
      |
      | implemented by
      +-- LocalNetwork
      +-- HttpNetwork
      +-- PostgresNetwork

Step contract --toLayer--> Effect<A, E, R> handler
      |
      | requires
      v
 application services R
      |
      | provided by
      v
 application Layers
```

The wrapper's job is to connect Resonate's durable execution model to this Effect dependency graph while preserving the semantics of both systems.

It should not hide those relationships behind a parallel configuration DSL.
