# Durable execution conventions

Target `@resonatehq/sdk/async`, not the generator engine.

Keep the execution boundary explicit:

- Resonate workflows own durable orchestration through `ctx.run`, `ctx.rpc`,
  `ctx.sleep`, `ctx.promise`, and related operations.
- Arbitrary Effect programs run inside registered steps or activities.
- Do not run a long-lived Effect program with `Effect.runPromise` inside a
  Resonate workflow and then continue issuing durable Resonate operations.

JSON-compatible values are the default durable data contract. Use runtime
schemas at actual trust boundaries. Add a codec only when a value needs a
deliberate persistence or wire representation.

Preserve Resonate semantics. The library is a small Effect-facing wrapper, not a
parallel workflow framework. See `docs/BRAINSTORM.md`
for the reasoning and current programming-model exploration.
