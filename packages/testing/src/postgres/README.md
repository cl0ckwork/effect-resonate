# Postgres conformance tests

Run the U5 provider scenarios against the official SDK Postgres network:

```sh
pnpm --filter @effect-resonate/testing test
```

Vitest global setup builds a Postgres 16 image with `pg_cron`, starts it with IntegreSQL under a unique Docker Compose project, applies the pinned [resonate.sql](docker/fixtures/resonate.sql) and documented SDK compatibility migration to an IntegreSQL template, and provides its ports and template hash to the tests. Each conformance scenario builds a fresh Effect Layer, gets its own IntegreSQL database, and schedules a timeout job for that database. The suite also checks missing-schema and bad-credential acquisition failures against the real server. Scope cleanup unschedules each job; Vitest teardown removes the Compose project and its databases.

Compose publishes both services on Docker assigned loopback host ports. Global setup discovers the assigned ports, so an existing local Postgres or IntegreSQL process does not claim the same host port. The schema version check expects `0.1.0` for the pinned SQL fixture; set `POSTGRES_TEST_SCHEMA_VERSION` when testing a fixture with another version.

Vitest provides the assigned ports and template hash to each worker. `PostgresTestEnv.layer` makes those values available as an Effect service, and `env.ts` owns the schema-version Config. Test setup does not write to `process.env`.

`itest(name, effect, options?)` follows Vitest's call style. Its optional `network` settings pass to the official SDK; `timing`, `setupTimeout`, and `invocationTimeoutMillis` configure the conformance harness. IntegreSQL supplies the connection string. Without a `network.tickMs` override, the SDK uses its own default.

The regular workspace `pnpm test` includes this suite. Set `SKIP_POSTGRES_TESTS=true` to run the other tests without Docker. Docker and network access are needed for the first image build. The upstream SQL revision is recorded in [UPSTREAM.md](docker/fixtures/UPSTREAM.md).
