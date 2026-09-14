# Agent guide

This is the canonical agent entrypoint. Root `AGENTS.md` and `CLAUDE.md` are
tracked symlinks to this file; edit this file rather than either link.

effect-resonate is a pnpm monorepo for an Effect TypeScript wrapper around the
Resonate durable execution engine. The primary package is
`@effect-resonate/core` under `packages/core`.

Read only the guidance relevant to the work:

| When working on | Read |
| --- | --- |
| Effect code or APIs | `.agents/conventions/effect.md` |
| Workflows, steps, durable values, or retries | `.agents/conventions/durable-execution.md` |
| Packages, modules, dependencies, or public exports | `.agents/conventions/repository.md` |
| Worktrees, direnv, dependencies, or generated agent links | `.agents/conventions/development.md` |
| Specs, plans, implementation, or review | `.agents/conventions/workflows.md` |

Project direction and prior decisions live in:

- `docs/BRAINSTORM.md`: current product and execution-model exploration; not an API commitment.
- `docs/PACKAGING.md`: current package topology and build direction.
- `docs/RELEASE-BRAINSTORM.md`: release ideas that are not yet wired or binding.

When guidance conflicts, prefer the narrower convention, then the newer explicit
decision. Update the relevant document when a decision changes instead of adding
the exception here.
