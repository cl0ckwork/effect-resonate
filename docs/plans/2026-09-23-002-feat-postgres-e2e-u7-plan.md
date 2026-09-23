# U7 implementation plan: Postgres conformance environment

Source: `docs/specs/2026-09-23-002-postgres-e2e-u7-spec.md`. Stack base: U6 PR #6.

1. Add `packages/testing/postgres` for the provider-specific Vitest global setup, harness, and fixtures. Keep Postgres and IntegreSQL client dependencies in the private testing package's development dependencies. Regular `pnpm test` includes Postgres; `SKIP_POSTGRES_TESTS=1` omits it.
2. Pin the official Postgres 16 base and IntegreSQL images by digest. Install `pg_cron` in the Postgres image, preload it, and create its extension in the control database. Use dynamically published loopback ports and a unique Compose project per invocation.
3. Vendor commit-pinned upstream `resonate.sql` unchanged. Apply it to the IntegreSQL template, then apply the separately documented SDK global-promise compatibility migration. Hash both migrations, upstream metadata, and image configuration. Close the migration connection before template finalization.
4. For every U5 scenario, lease a database, verify schema/version, schedule and verify a named `cron.schedule_in_database` timeout job, provide the Postgres network and harness Layers, then unschedule and return the lease after workers stop. Keep the same lease across worker replacement.
5. Run all eight U5 scenarios locally and in the Postgres GitHub Actions job. Verify testing package typecheck, regular `pnpm check` and `pnpm test`, Docker-backed Postgres test, and Compose teardown. Add concise run instructions and record the SQL provenance.

Risks: the pinned SQL's generated `external` field does not recognize SDK 0.11.5's `resonate:scope=global`; without the compatibility migration, recovery can fail with `task.suspend` status 422. Keep this patch isolated so a future upstream SQL update can remove it deliberately. A worker may stop while a task is still acquired; the shared recovery scenario uses a five-second task lease so PostgreSQL's timeout driver can reassign it within the bounded test deadline.
