# @effect-resonate/core

Effect-native primitives for integrating [Effect](https://effect.website/) with [Resonate](https://resonatehq.io/) durable execution.

This package is under active implementation. The approved behavior lives in
the repository's [`core async/Postgres specification`](../../docs/specs/2026-09-15-001-core-async-postgres-spec.md).

The intended split is:

- Resonate owns durable orchestration, replay, timers, and distributed calls.
- Effect owns application effects, typed errors, dependency injection, resources, tracing, and integrations.
- Workflow and step definitions are inert, schema-first durable contracts.
- `toLayer` supplies implementations while preserving ordinary Effect service requirements.
- Service-free codecs validate and transform every value crossing Resonate persistence.

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

The function group is the closed contract registry. Implementations and the
provider network remain ordinary Layer dependencies rather than configuration
inside the client constructor.

```ts
class CheckoutFunctions extends ResonateFunctions.make(
  ChargeCardV1,
  ChargeCardV2,
  Checkout
) {}

const ResonateLive = ResonateClient.layer({
  functions: CheckoutFunctions,
  drainTimeout: Duration.seconds(30)
}).pipe(
  Layer.provide([
    ChargeCardV1Live,
    ChargeCardV2Live,
    CheckoutLive,
    ResonateNetworkLive
  ])
)
```

`ResonateClient.layer` validates the complete registry before constructing the
network, waits for network readiness and exact-version registration, and owns
graceful shutdown. Its `run`, `attach`, and external-promise operations expose
schema and SDK failures in the Effect error channel.

The drain timeout applies to admitted Effect step handlers. Resonate owns async
workflow frames and resumes unfinished durable work through its normal lease and
replay behavior.
