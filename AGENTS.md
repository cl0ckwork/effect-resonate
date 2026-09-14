# Repository guidance

This repository uses Effect TypeScript and Resonate.

## Learning more about Effect

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` completely and follow the links in that file when required.

If an Effect API or concept is unclear, prefer reading `node_modules/effect/src` over guessing from old examples.

## Resonate execution model

Target `@resonatehq/sdk/async`, not the generator engine.

Keep the execution boundary explicit:

- durable orchestration stays in Resonate workflows (`ctx.run`, `ctx.rpc`, `ctx.sleep`, `ctx.promise`, etc.)
- arbitrary Effect programs run inside registered steps / activities
- do not `Effect.runPromise` arbitrary long-lived Effect programs inside a Resonate durable workflow and then continue issuing durable Resonate operations

Treat JSON-compatible values as the default durable data contract. Use runtime schemas at actual trust boundaries and codecs only when a value needs a deliberate persistence / wire representation.

## Design bias

Prefer a small wrapper over a parallel workflow framework. Preserve Resonate semantics and expose Effect where it adds concrete value: services, layers, typed failures, resource management, tracing, and integrations.
