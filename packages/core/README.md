# @effect-resonate/core

Effect-native primitives for integrating [Effect](https://effect.website/) with [Resonate](https://resonatehq.io/) durable execution.

This package is pre-implementation. The current design direction lives in the repository's [`docs/BRAINSTORM.md`](../../docs/BRAINSTORM.md).

The intended split is:

- Resonate owns durable orchestration, replay, timers, and distributed calls.
- Effect owns application effects, typed errors, dependency injection, resources, tracing, and integrations.
- TypeScript handles trusted internal contracts.
- Runtime schema validation is reserved for real trust boundaries such as workflow ingress and externally resolved signals.
- Codecs are opt-in for durable values that need a deliberate wire representation beyond JSON-compatible values.
