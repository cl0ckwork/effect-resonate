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
  ResonateClientError,
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
    readonly network: Network
  }
>()("@effect-resonate/core/ResonateNetwork") {}
```

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

`ResonateClient` is the Effect-facing API used by applications to start, inspect, and interact with durable workflows.

Its constructor reads `ResonateNetwork` from the Effect context and constructs the underlying Resonate SDK instance.

Conceptually:

```ts
const make = Effect.gen(function* () {
  const { network } = yield* ResonateNetwork

  const resonate = new Resonate({ network })

  yield* Effect.addFinalizer(() =>
    Effect.promise(() => resonate.stop())
  )

  return {
    run: ...,
    get: ...,
    resolve: ...,
  }
})

export const layer = Layer.scoped(
  ResonateClient,
  make,
)
```

The resulting Layer still requires `ResonateNetwork`.

The application satisfies that dependency using normal Effect composition.

---

## PostgreSQL example

Direct PostgreSQL execution should look like ordinary Layer composition:

```ts
import { Config, Effect, Layer } from "effect"
import * as PostgresNetwork from "@effect-resonate/core/PostgresNetwork"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"

const PostgresResonate =
  ResonateClient.layer.pipe(
    Layer.provide(
      PostgresNetwork.layer({
        connectionString: Config.redacted("DATABASE_URL"),
      }),
    ),
  )
```

Application code depends only on the client service:

```ts
const program = Effect.gen(function* () {
  const resonate = yield* ResonateClient.ResonateClient

  return yield* resonate.run(
    Checkout,
    "checkout-123",
    input,
  )
})

program.pipe(
  Effect.provide(PostgresResonate),
  Effect.runPromise,
)
```

The workflow does not know or care that Postgres is the selected Resonate network.

---

## Other networks are symmetric

Cloud / self-hosted server:

```ts
const CloudResonate =
  ResonateClient.layer.pipe(
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
  ResonateClient.layer.pipe(
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
ResonateClient.layer.pipe(
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

If an application provides `ResonateClient.layer` without providing a network, the Effect should still retain a `ResonateNetwork` requirement.

Conceptually, this should not typecheck as a fully runnable program:

```ts
program.pipe(
  Effect.provide(ResonateClient.layer),
  Effect.runPromise,
)
```

because the graph is incomplete.

The user must complete it:

```ts
const ResonateLive = ResonateClient.layer.pipe(
  Layer.provide(PostgresNetwork.layer(...)),
)

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
const ChargeCard = Step.make(
  "payments.charge",
  (input: ChargeInput) =>
    Effect.gen(function* () {
      const payments = yield* Payments
      const tracer = yield* Tracer

      return yield* payments.charge(input)
    }),
)
```

Its Effect already communicates its requirements:

```text
Effect<ChargeReceipt, PaymentDeclined, Payments | Tracer>
```

The worker runtime should execute that Effect using the application's supplied Layer graph.

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

Step Effect<A, E, R>
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
