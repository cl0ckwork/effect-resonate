# Packaging and repository topology

Status: current direction; revisit when the first package is ready to publish.

## Package namespace

Use `@effect-resonate/*` for published packages.

The foundational package is:

```text
@effect-resonate/core
```

Do not use the `@effect/*` scope; that would imply official ownership by the Effect project.

## Monorepo from day one, packages at real boundaries

The repository is a pnpm workspace so future runtime/testing integrations can be added without renaming the core package or migrating repository structure later.

```text
packages/
  core/              @effect-resonate/core
  network-postgres/  @effect-resonate/network-postgres
  testing/           @effect-resonate/testing (private initially)
    src/postgres/    Docker, IntegreSQL, and SQL acceptance fixtures
examples/            workspace consumers / integration examples
docs/                architecture notes
```

Being a monorepo is not a reason to split modules into packages. `Workflow`, `Step`, `ResonateClient`, `Network`, and similar concepts should remain module entrypoints inside `@effect-resonate/core`.

Create another npm package only when there is a concrete boundary such as:

- materially different or optional dependencies;
- a distinct runtime/environment;
- testing-only functionality that should not ship with production code;
- a package that is independently useful/versionable.

The first justified boundaries are:

- `@effect-resonate/core` owns the provider-neutral programming model,
  lifecycle, adapters, and `ResonateNetwork` contract. It has no knowledge of
  Postgres, `pg`, provider configuration, or provider fixtures.
- `@effect-resonate/network-postgres` owns the official
  `@resonatehq/sdk/postgres` adapter, its Effect Layer and configuration, and
  the `pg` dependency boundary. Other networks should follow the same
  composition shape rather than requiring changes in core.
- `@effect-resonate/testing` is private initially and owns reusable black-box
  network conformance and recovery scenarios. Production packages do not ship
  those scenarios.
- `packages/testing/src/postgres` composes core, the Postgres provider, the shared
  scenarios, IntegreSQL, schema fixtures, worker processes, and CI orchestration.
  Its dependencies are development-only dependencies of the private testing
  package. Vitest global setup manages Docker for regular workspace tests;
  `SKIP_POSTGRES_TESTS=true` skips those tests when Docker is unavailable.

Keep provider unit tests with their provider package. Keep cross-package runtime
evaluation under testing rather than teaching core about the first supported
network.

## Build model

Use `zshy` for package compilation.

Goals:

- bundler-free TypeScript library output;
- ESM-only initially;
- generated declaration files and package exports;
- preserve module boundaries for consumer tree-shaking;
- do not bundle Effect or Resonate.

`effect` and `@resonatehq/sdk` are peer dependencies of core and are also
installed as development dependencies for local compilation/testing.

The Postgres network package declares core, Effect, Resonate, and `pg` as peer
dependencies and installs them for development. Consumers select and install
the provider explicitly. Installing or importing core never loads or resolves
Postgres code or `pg`.

The current `zshy` export map exposes the root entrypoint and the stable core
module entrypoints, including `./Workflow`, `./Step`, and `./ResonateClient`.
Keep packed-consumer typechecks covering both root and subpath imports whenever
the public export map changes.

## TypeScript

Pin the build to the TypeScript 5.x compiler line while `zshy` relies on the TypeScript JS compiler API. Revisit this when the toolchain supports TypeScript 7.

## Release process (planned, not yet wired)

When the API is ready for its first npm release:

1. add Changesets for package versioning/changelogs;
2. validate packed output with `publint` and `@arethetypeswrong/cli`;
3. publish from GitHub Actions using npm trusted publishing / OIDC rather than a long-lived `NPM_TOKEN`;
4. enable npm provenance;
5. keep the packed-artifact consumer typecheck in the release gate rather than
   relying only on source-level workspace imports.

Avoid adding release automation before there is a package worth releasing.
