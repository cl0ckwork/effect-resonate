# Postgres conformance tests

Run the U5 provider scenarios against the official SDK Postgres network:

```sh
pnpm --filter @effect-resonate/testing test:postgres
```

The command builds a Postgres 16 image with `pg_cron`, starts it with IntegreSQL under a unique Docker Compose project, applies the pinned `fixtures/resonate.sql` and the documented SDK compatibility migration to an IntegreSQL template, and leases a fresh database for each scenario. It verifies the schema and a per-lease timeout job before running each scenario. The suite also checks missing-schema and bad-credential acquisition failures against the real server. Cleanup unschedules the job, returns the database, and removes only the Compose project created by the command.

The regular workspace `pnpm test` runs without Docker; this suite is an explicit integration gate. Docker and network access are needed for the first image build. The upstream SQL revision and fixture hash inputs are recorded in [fixtures/UPSTREAM.md](fixtures/UPSTREAM.md).
