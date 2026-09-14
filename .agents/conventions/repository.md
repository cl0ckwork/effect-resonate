# Repository and package conventions

This is a pnpm monorepo, but architectural modules do not automatically justify
new npm packages. Add a package only for a real dependency, runtime, testing, or
distribution boundary.

Keep concepts such as `Workflow`, `Step`, and `ResonateClient` as stable module
entrypoints within `@effect-resonate/core` until a separate package boundary is
needed.

`@effect-resonate/core` uses `zshy` and remains bundler-free. Keep Effect and
Resonate as peer dependencies so consumers own both runtimes.

Read `docs/PACKAGING.md` before changing workspace
topology, package exports, build output, or dependency placement.
