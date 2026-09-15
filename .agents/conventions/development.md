# Development environment

A fresh worktree does not contain dependencies or generated tool-specific agent
links.

- `pnpm run doctor` is a read-only readiness check. Each failure includes its
  repair command.
- `bash scripts/worktree-up` installs dependencies, restores pinned skills,
  repairs generated agent links, and runs the doctor. It is idempotent and
  serializes concurrent setup in the same worktree.
- `.envrc` establishes paths, loads optional local environment files, and repairs
  cheap agent links. Run `direnv allow` after cloning or changing it.
- Lefthook runs staged whitespace and relevant TypeScript checks before commits,
  then runs typechecking and tests before pushes. Dependency installation wires
  the Git hooks; `pnpm run doctor` reports when they are missing.

Canonical agent configuration lives under `.agents/`. Treat root `AGENTS.md`,
`CLAUDE.md`, and tool-specific views as generated links.
