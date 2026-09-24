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
- `mise.toml` tracks the contributor Node.js 24 version used by the release
  workflow. Run `mise trust` and `mise install` before bootstrap.
  `package.json#packageManager` pins pnpm; `worktree-up` installs that version
  when needed.
- Lefthook checks staged whitespace and formatting, then lints and typechecks
  relevant code before commits. It runs typechecking and tests before pushes.
  Dependency installation wires the Git hooks; `pnpm run doctor` reports when
  they are missing.

Canonical agent configuration lives under `.agents/`. Treat root `AGENTS.md`,
`CLAUDE.md`, and tool-specific views as generated links.
