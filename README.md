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

## Development setup

The repository uses direnv for a cheap, repeatable shell environment and keeps
AI-agent configuration in the committed `.agents/` directory.

Install Node.js and [direnv](https://direnv.net/) first. The bootstrap installs
the repository's pinned pnpm version when needed.

```sh
direnv allow
bash scripts/worktree-up
```

`bash scripts/worktree-up` installs the pinned pnpm toolchain when needed, installs
workspace dependencies, repairs agent-tool symlinks, and finishes with the
read-only `pnpm run doctor` readiness check. It is idempotent and serializes
concurrent setup in the same Git worktree.

Repo-local agent workflows are available as `er-spec` for specifications and
`er-plan` for implementation plans, and `er-review` for pre-commit or PR review.
The review workflow has focused durability, correctness, Effect, testing,
architecture, and repository-tooling agents. The official `effect-ts` skill is pinned
in `skills-lock.json` alongside Resonate's philosophy, async TypeScript, and
Temporal migration skills; worktree bootstrap restores all four. Specifications
and plans are written under `docs/specs/` and `docs/plans/`.

[Lefthook](https://lefthook.dev/) installs with the workspace dependencies. It
checks staged whitespace and relevant TypeScript changes before commits, then
runs typechecking and tests before pushes.

## Status

Brainstorm / pre-implementation.
