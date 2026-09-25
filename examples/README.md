# Examples

- [PostgreSQL workflows](./postgres/README.md) starts a local database, applies
  `resonate.sql` and the SDK compatibility migration, then runs a V1 workflow
  and its evolved V2 contract.
- [In-memory workflow test](./in-memory/README.md) runs a typed workflow with
  Resonate's `LocalNetwork` and checks its result without Docker.
- [Published npm consumer](./npm-consumer/README.md) runs the same kind of
  workflow test against the released `@effect-resonate/core` package installed
  from npm. It does not link to this checkout.

The in-memory and PostgreSQL examples are private pnpm workspace packages that
exercise this checkout. The npm consumer is also a private workspace package,
but its core dependency is a version range so pnpm resolves the published npm
artifact. Start with the README in each directory for setup and commands.
