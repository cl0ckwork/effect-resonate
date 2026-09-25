# Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

# Effect conventions

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
