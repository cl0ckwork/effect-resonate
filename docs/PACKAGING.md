# Packaging and repository topology

This document describes the package boundaries, build model, and release
workflow. See [RELEASING.md](./RELEASING.md) for maintainer setup.

## Package boundaries

The workspace contains one public package and one private test package:

```text
packages/
  core/     @effect-resonate/core
  testing/  @effect-resonate/testing (private)
```

- `@effect-resonate/core` owns the client lifecycle, workflow and step
  contracts, and `ResonateNetwork` service. It peers on Effect and the Resonate
  SDK. Applications pass SDK networks through `ResonateNetwork.layer`; the SDK
  owns its PostgreSQL provider and optional `pg` peer.
- `@effect-resonate/testing` owns reusable black-box provider conformance and
  recovery scenarios. It is private and is not a production dependency.
  `packages/testing/src/postgres` contains Docker, IntegreSQL, SQL fixtures, and
  the Postgres test harness.

Keep concepts such as `Workflow`, `Step`, `ResonateClient`, and
`ResonateNetwork` as module entrypoints within core. Add a package only for a
real runtime, dependency, testing, or distribution boundary.

## Build and exports

Core uses `zshy` for unbundled ESM output and generated declarations. Effect
and Resonate remain peer dependencies so applications own their runtimes. Core
does not import or depend on `pg`; applications that use the SDK PostgreSQL
network install it as the SDK's optional peer.

Core exposes a root entrypoint and module subpaths, including `./Workflow`,
`./Step`, `./ResonateClient`, and `./ResonateNetwork`.
Preserve these entrypoints when changing source layout or package manifests.
Packed-consumer typechecks should cover root and subpath imports when the
export map changes.

## Testing packages

Network conformance tests run through the private testing package, which keeps
test-only dependencies out of core. Its Postgres integration suite starts isolated
PostgreSQL and IntegreSQL services, applies pinned fixtures, and uses a fresh
database per scenario. Regular workspace `pnpm test` includes that suite;
`SKIP_POSTGRES_TESTS=true` omits it when Docker is unavailable.

## Release automation

Changesets records version and changelog intent for core. `pnpm check` builds
and validates its packed output with `publint`,
`@arethetypeswrong/cli`, and a clean packed consumer. CI runs the root
`pnpm test`, including the packed-consumer tests and Postgres integration suite.

The release workflow opens a version PR from Changesets, then validates and
stages missing versions from a separate GitHub OIDC job. Staging uses the npm
CLI directly; a maintainer approves each version with 2FA before it becomes
public. The private testing package is never staged. Automated staging starts
after the core package name exists on npm and has a stage-only trusted
publisher configured.
Follow [RELEASING.md](./RELEASING.md) for that owner-run setup and the normal
release sequence.
