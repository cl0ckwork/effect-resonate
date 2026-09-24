# Examples

- [PostgreSQL workflows](./postgres/README.md) starts a local database, applies
  `resonate.sql` and the SDK compatibility migration, then runs a V1 workflow
  and its evolved V2 contract.
- [In-memory workflow test](./in-memory/README.md) runs a typed workflow with
  Resonate's `LocalNetwork` and checks its result without Docker.

Both examples are private pnpm workspace packages. Start with the README in
each directory for setup and commands.
