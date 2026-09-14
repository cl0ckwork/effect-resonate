# effect-resonate

An Effect-native TypeScript integration for [Resonate](https://resonatehq.io/) durable execution.

The repository is a lightweight pnpm monorepo. The initial and only publishable package is:

- [`@effect-resonate/core`](./packages/core) — the Effect/Resonate integration primitives.

Additional packages should only be introduced when they represent a real runtime, dependency, or testing boundary rather than for architectural neatness.

The intended split is simple:

- **Resonate** owns durable orchestration, replay, timers, and distributed calls.
- **Effect** owns application effects, typed errors, dependency injection, resources, tracing, and integration services.
- **TypeScript** is the default contract between trusted workflow steps.
- **Schema validation** is reserved for real trust boundaries such as workflow ingress and externally resolved signals.
- **Codecs** are opt-in when durable values need a deliberate persistence / wire representation beyond JSON-compatible values.

The wrapper targets Resonate's `@resonatehq/sdk/async` engine. Effect generators stay inside Effect programs; Resonate durable workflows use normal `async` / `await`.

See [`docs/BRAINSTORM.md`](./docs/BRAINSTORM.md) for the current architecture direction.

## Workspace

```text
packages/
  core/        @effect-resonate/core
examples/      integration examples as workspace consumers (when added)
docs/          architecture and design notes
```

Build tooling is intentionally bundler-free: `@effect-resonate/core` uses [`zshy`](https://github.com/colinhacks/zshy) to compile TypeScript and generate package exports.

## Status

Brainstorm / pre-implementation.
