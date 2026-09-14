# Repository guidance

This is the canonical agent instruction file. Root `AGENTS.md` and `CLAUDE.md`
are tracked symlinks to this file; edit this file rather than either link.

This repository uses Effect TypeScript and Resonate. It is a pnpm monorepo; the primary package lives at `packages/core` and is published as `@effect-resonate/core`.

Do not create additional packages merely to mirror architectural modules. Add a package only when there is a real dependency, runtime, testing, or distribution boundary.

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

## Package design

`@effect-resonate/core` uses `zshy` and should remain bundler-free. Keep Effect and Resonate as peer dependencies rather than bundling either runtime.

Prefer stable module entrypoints inside core (`Workflow`, `Step`, `ResonateClient`, etc.) over creating npm packages for each module.

## Design bias

Prefer a small wrapper over a parallel workflow framework. Preserve Resonate semantics and expose Effect where it adds concrete value: services, layers, typed failures, resource management, tracing, and integrations.

## Environment contract

A fresh worktree does not contain dependencies or generated tool-specific agent
links.

- `pnpm run doctor` is a read-only readiness check and prints a repair command for
  every missing prerequisite.
- `bash scripts/worktree-up` installs dependencies, repairs generated agent links, and
  finishes by running the doctor. It is safe to run repeatedly and serializes
  concurrent setup in the same worktree.
- `.envrc` only establishes paths, loads optional local environment files, and
  repairs cheap agent links. After cloning or changing it, the developer must
  run `direnv allow`.

## Repo-local workflows

- Use `er-spec` to turn ambiguous or cross-cutting feature intent into a
  reviewable specification under `docs/specs/`.
- Use `er-plan` to turn an approved specification or concrete request into an
  executable implementation plan under `docs/plans/`.
- Use `er-review` to review a working tree, branch, commit, or PR before it is
  committed or submitted. Select only the reviewer agents relevant to the diff.
