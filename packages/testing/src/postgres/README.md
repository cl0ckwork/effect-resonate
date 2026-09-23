# Postgres conformance tests

Run the U5 provider scenarios against the official SDK Postgres network:

```sh
pnpm --filter @effect-resonate/testing test
```

Vitest global setup builds a Postgres 16 image with `pg_cron`, starts it with IntegreSQL under a unique Docker Compose project, applies the pinned `fixtures/resonate.sql` and the documented SDK compatibility migration to an IntegreSQL template, and provides its ports and template hash to the tests. Each scenario leases a fresh database and verifies the schema and a per-lease timeout job. The suite also checks missing-schema and bad-credential acquisition failures against the real server. Cleanup unschedules the job, returns the database, and removes only the Compose project created by the test run.

The regular workspace `pnpm test` includes this suite. Set `SKIP_POSTGRES_TESTS=true` to run the other tests without Docker. Docker and network access are needed for the first image build. The upstream SQL revision and fixture hash inputs are recorded in [fixtures/UPSTREAM.md](fixtures/UPSTREAM.md).
