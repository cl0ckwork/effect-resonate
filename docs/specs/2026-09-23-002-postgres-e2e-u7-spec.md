# U7: Postgres conformance environment

Status: implemented on the U7 branch, stacked on U6.

## Objective and scope

Run U5's eight reusable provider scenarios through `@effect-resonate/network-postgres` against an isolated, migrated PostgreSQL 16 database. Check real missing-schema and bad-credential acquisition failures as well. Keep Docker, IntegreSQL, and SQL fixtures in a private app. The production packages must not gain test infrastructure dependencies.

One command starts the services, prepares a hashed template, leases a fresh database for each scenario, and removes the services it started. The regular unit test command remains independent of Docker. Wider U7 crash-window and version-deployment acceptance cases in the original program plan remain separate follow-up work.

## Walkthroughs and invariants

| Path | Observable result | Invariant |
| --- | --- | --- |
| Runner starts with no services → Compose starts Postgres and IntegreSQL → template migration applies | Required Resonate procedures and pg_cron are present before any scenario runs | S1 |
| Two scenarios request a lease → IntegreSQL clones the same template twice | Their durable rows cannot overlap even when execution IDs repeat | S2 |
| A worker stops after a checkpoint → another worker uses the same lease | The U5 recovery scenario resumes without redoing the checkpointed step; its short task lease allows a bounded retry if the first worker stopped before suspension | S2, S3 |
| A scenario fails after lease creation → teardown unschedules its cron job and returns its lease | Later scenarios do not inherit its job, connections, or database state | S2, L1 |

- **S1:** A scenario never runs against an unmigrated or wrong-version database. Template setup applies a commit-pinned `resonate.sql`, then a separately recorded SDK compatibility migration; lease setup checks the schema and active cron job.
- **S2:** Every scenario gets a distinct IntegreSQL lease; worker replacement within one scenario keeps that lease. The test app owns lease release after workers stop.
- **S3:** The U5 scenario suite remains provider-neutral. Only this app selects the Postgres Layer.
- **L1:** The runner removes only the Compose project it created; each lease cleanup unschedules its job and returns the database even after a scenario failure.

## Migration and failure boundary

The pinned upstream revision is `resonatehq/resonate-pg@54fe65150f42f39f415363d05cd54ff91a069b1c`. `fixtures/UPSTREAM.md` records its checksum. SDK 0.11.5 marks `ctx.promise()` with `resonate:scope=global`; this SQL revision omits that tag from its generated `external` classification. The separate `001-sdk-global-promise.sql` migration aligns that classification with the SDK. Both SQL files and image configuration are included in the IntegreSQL template hash.

Template setup closes its SQL connection before finalization, as IntegreSQL requires. A failed migration aborts setup; a failed lease readiness check or scenario still triggers cleanup. PostgreSQL diagnostic text may appear in the local test runner, but the conformance scenarios report only their sanitized observations.

Sources: `packages/testing/src/NetworkHarness.ts`, `packages/testing/src/NetworkScenarios.ts`, `packages/testing/src/RecoveryScenarios.ts`, `packages/network-postgres/src/PostgresNetwork.ts`, and `docs/specs/2026-09-15-001-core-async-postgres-spec.md`.
