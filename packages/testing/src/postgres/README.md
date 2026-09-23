# Postgres conformance tests

Run the U5 provider scenarios against the official SDK Postgres network:

```sh
pnpm --filter @effect-resonate/testing test
```

Vitest global setup builds a Postgres 16 image with `pg_cron`, starts it with IntegreSQL under a unique Docker Compose project, applies the pinned [resonate.sql](docker/fixtures/resonate.sql) and documented SDK compatibility migration to an IntegreSQL template, and provides its ports and template hash to the tests. Each conformance scenario builds a fresh Effect Layer, gets its own IntegreSQL database, and schedules a timeout job for that database. The suite also checks missing-schema and bad-credential acquisition failures against the real server. Scope cleanup unschedules each job; Vitest teardown removes the Compose project and its databases.

`itest` accepts optional `network` settings passed to the official SDK and separate `timing`, `setupTimeout`, and `invocationTimeoutMillis` settings for the conformance harness. IntegreSQL supplies the connection string. Without a `network.tickMs` override, the SDK uses its own default.

The regular workspace `pnpm test` includes this suite. Set `SKIP_POSTGRES_TESTS=true` to run the other tests without Docker. Docker and network access are needed for the first image build. The upstream SQL revision is recorded in [UPSTREAM.md](docker/fixtures/UPSTREAM.md).
