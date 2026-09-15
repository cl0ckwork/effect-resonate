# Effect conventions

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and
follow its linked guidance when required.

When an Effect API or concept is unclear, inspect `node_modules/effect/src`
instead of relying on remembered or older examples.

Use Effect where it adds concrete value: services, layers, typed failures,
resource management, tracing, and integrations. The durable execution boundary
is defined separately in `.agents/conventions/durable-execution.md`.
