# effect-resonate

An Effect-native TypeScript integration for [Resonate](https://resonatehq.io/) durable execution.

The intended split is simple:

- **Resonate** owns durable orchestration, replay, timers, and distributed calls.
- **Effect** owns application effects, typed errors, dependency injection, resources, tracing, and integration services.
- **TypeScript** is the default contract between workflow steps.
- **Schema validation** is reserved for real trust boundaries such as workflow ingress and externally resolved signals.
- **Codecs** are opt-in when durable values need a deliberate persistence / wire representation beyond JSON-compatible values.

The wrapper targets Resonate's `@resonatehq/sdk/async` engine. Effect generators stay inside Effect programs; Resonate durable workflows use normal `async` / `await`.

See [`docs/BRAINSTORM.md`](./docs/BRAINSTORM.md) for the current architecture direction.

## Status

Brainstorm / pre-implementation.
