# U7: Postgres conformance environment

Status: implemented on the U7 branch, stacked on U6.

## Objective and scope

Run U5's eight reusable provider scenarios through `@effect-resonate/network-postgres` against an isolated, migrated PostgreSQL 16 database. Check real missing-schema and bad-credential acquisition failures as well. Keep Docker, IntegreSQL, and SQL fixtures under the private `@effect-resonate/testing` package. The production packages must not gain test infrastructure dependencies.

Vitest global setup starts the services, prepares a hashed template, provides its ports and hash to the tests, and removes the services after the run. Each conformance scenario gets a fresh database through a scoped Effect Layer. The acquisition-failure checks use the control database. Regular `pnpm test` includes these tests; `SKIP_POSTGRES_TESTS=true` omits the Postgres integration suite when Docker is unavailable. Wider U7 crash-window and version-deployment acceptance cases in the original program plan remain separate follow-up work.

## Walkthroughs and invariants

| Path | Observable result | Invariant |
| --- | --- | --- |
| Runner starts with no services → Compose starts Postgres and IntegreSQL → template migration applies | Required Resonate procedures and pg_cron are present before any scenario runs | S1 |
| Two tests request databases → IntegreSQL clones the same template twice | Their durable rows cannot overlap even when execution IDs repeat | S2 |
| A worker stops after a checkpoint → another worker uses the same database | The U5 recovery scenario resumes without redoing the checkpointed step; its short task lease allows a bounded retry if the first worker stopped before suspension | S2, S3 |
| A test fails after database creation → its Effect scope unschedules its cron job | Later tests do not inherit its job, connections, or database state | S2, L1 |

- **S1:** A scenario never runs against an unmigrated or wrong-version database. Template setup applies a commit-pinned `resonate.sql`, then a separately recorded SDK compatibility migration and verifies its version; each test verifies its active cron job.
- **S2:** Every test gets a distinct IntegreSQL database; worker replacement within one scenario keeps that database. Vitest teardown removes the cloned databases with the Compose project.
- **S3:** The U5 scenario suite remains provider-neutral. Only the Postgres test harness selects the Postgres Layer.
- **L1:** Vitest teardown removes only the Compose project it created; each test's Effect scope unschedules its timeout job even after a scenario failure.

## Migration and failure boundary

The pinned upstream revision is `resonatehq/resonate-pg@54fe65150f42f39f415363d05cd54ff91a069b1c`. `src/postgres/docker/fixtures/UPSTREAM.md` records its checksum. Published SDK 0.11.5 marks `ctx.promise()` with `resonate:scope=global`; this SQL revision omits that tag from its generated `external` classification. The separate `001-sdk-global-promise.sql` migration bridges the mismatch. SDK source commit `a3a3ccf` adds `resonate:external=true` but is not yet published; remove the migration when that fix ships and the recovery test passes without it. IntegreSQL's `hashFiles` covers the migration fixtures.

Template setup closes its SQL connection before finalization, as IntegreSQL requires. A failed migration aborts setup; a failed timeout job setup or scenario still triggers cleanup. SDK and PostgreSQL diagnostics remain available to the test runner.

Sources: `packages/testing/src/NetworkHarness.ts`, `packages/testing/src/NetworkScenarios.ts`, `packages/testing/src/RecoveryScenarios.ts`, `packages/network-postgres/src/PostgresNetwork.ts`, and `docs/specs/2026-09-15-001-core-async-postgres-spec.md`.
