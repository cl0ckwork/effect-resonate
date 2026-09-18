# Effect conventions

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and
follow its linked guidance when required.

When an Effect API or concept is unclear, inspect `node_modules/effect/src`
instead of relying on remembered or older examples.

Use Effect where it adds concrete value: services, layers, typed failures,
resource management, tracing, and integrations. The durable execution boundary
is defined separately in `.agents/conventions/durable-execution.md`.

Use Effect's native matching and data-type utilities instead of reimplementing
their control flow with vanilla JavaScript:

- Match trusted discriminated unions with `Match.valueTags` or a reusable
  `Match.type(...).pipe(Match.tagsExhaustive(...))` matcher.
- Match untrusted discriminator values with `Match.value(...).pipe(...)` and an
  explicit fallback.
- Match Effect data types through their native APIs, such as `Result.match`,
  `Option.match`, and `Exit.match`.
- Do not use `switch` statements or compare `_tag` manually. ESLint enforces
  both rules repository-wide.
