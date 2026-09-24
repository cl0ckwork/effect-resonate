# Agent guide

Always read @.agents/conventions/engineering_principles.md

This is the canonical agent entrypoint. Root `AGENTS.md` and `CLAUDE.md` are
tracked symlinks to this file; edit this file rather than either link.

effect-resonate is a pnpm monorepo for an Effect TypeScript wrapper around the
Resonate durable execution engine. The primary package is
`@effect-resonate/core` under `packages/core`.

Read only the guidance relevant to the work:

| When working on                                           | Read                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| Effect code or APIs                                       | `.agents/conventions/effect.md`                   |
| Resonate philosophy, SDK APIs, or Temporal migration      | `.agents/conventions/upstream-resonate-skills.md` |
| Workflows, steps, durable values, or retries              | `.agents/conventions/durable-execution.md`        |
| Packages, modules, dependencies, or public exports        | `.agents/conventions/repository.md`               |
| Worktrees, direnv, dependencies, or generated agent links | `.agents/conventions/development.md`              |
| Specs, plans, implementation, or review                   | `.agents/conventions/workflows.md`                |

Project direction and prior decisions live in:

- `docs/ARCHITECTURE.md`: current execution model and durable behavior.
- `docs/planned-features/EXECUTION-INSPECTION.md`: future read-only execution graph and observability direction; not an API commitment.
- `docs/PACKAGING.md`: current package topology and build direction.
- `docs/RELEASING.md`: current release and npm staging process.

When guidance conflicts, prefer the narrower convention, then the newer explicit
decision. Update the relevant document when a decision changes instead of adding
the exception here.
