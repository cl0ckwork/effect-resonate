# Packaging and repository topology

Status: current package boundaries, build model, and release workflow are
implemented. The first npm publication and npm-side trusted publisher setup
remain; see [RELEASING.md](./RELEASING.md).

## Package boundaries

Use the `@effect-resonate/*` namespace. The workspace currently contains:

```text
packages/
  core/              @effect-resonate/core
  network-postgres/  @effect-resonate/network-postgres
  testing/           @effect-resonate/testing (private)
```

- `@effect-resonate/core` owns the provider-neutral programming model, client
  lifecycle, workflow and step contracts, adapters, and `ResonateNetwork`
  service. It does not depend on PostgreSQL or `pg`.
- `@effect-resonate/network-postgres` adapts the official SDK PostgreSQL
  network. It peers on core, Effect, the Resonate SDK, and `pg`; consumers
  install the provider and its peer dependencies explicitly.
- `@effect-resonate/testing` owns reusable black-box provider conformance and
  recovery scenarios. It is private and is not a production dependency.
  `packages/testing/src/postgres` contains Docker, IntegreSQL, SQL fixtures, and
  the Postgres test harness.

Keep concepts such as `Workflow`, `Step`, `ResonateClient`, and
`ResonateNetwork` as module entrypoints within core. Add a package only for a
real runtime, dependency, testing, or distribution boundary.

## Build and exports

Production packages use `zshy` for unbundled ESM output and generated
declarations. Effect and Resonate remain peer dependencies so applications
own their runtimes. The packages declare the same dependencies as development
dependencies for workspace builds and tests. The Postgres package also peers on
`pg`; core does not import or resolve provider code.

Core exposes a root entrypoint and module subpaths, including `./Workflow`,
`./Step`, `./ResonateClient`, and `./ResonateNetwork`. The Postgres provider
exposes its root and `./PostgresNetwork`. Preserve these entrypoints when
changing source layout or package manifests. Packed-consumer typechecks should
cover root and subpath imports when the export map changes.

## Testing packages

Provider unit tests stay with their provider. Cross-package conformance tests
run through the private testing package, which keeps test-only dependencies out
of production packages. Its Postgres integration suite starts isolated
PostgreSQL and IntegreSQL services, applies pinned fixtures, and uses a fresh
database per scenario. Regular workspace `pnpm test` includes that suite;
`SKIP_POSTGRES_TESTS=true` omits it when Docker is unavailable.

## Release automation

Changesets records version and changelog intent for the two public packages.
`pnpm check` builds and validates their packed output with `publint`,
`@arethetypeswrong/cli`, and a clean packed consumer. CI runs the root
`pnpm test`, including the packed-consumer tests and Postgres integration suite.

The release workflow opens a version PR from Changesets, then validates and
stages missing versions from a separate GitHub OIDC job. Staging uses the npm
CLI directly; a maintainer approves each version with 2FA before it becomes
public. The private testing package is never staged. Because the public
package names are not yet present on npm, automated staging is guarded until
both have been bootstrapped and configured with stage-only trusted publishers.
Follow [RELEASING.md](./RELEASING.md) for that owner-run setup and the normal
release sequence.
