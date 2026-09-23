# Resonate Postgres schema fixture

`resonate.sql` is vendored from [`resonatehq/resonate-pg`](https://github.com/resonatehq/resonate-pg/blob/54fe65150f42f39f415363d05cd54ff91a069b1c/resonate.sql) at commit `54fe65150f42f39f415363d05cd54ff91a069b1c`.

SHA-256: `f4cc2e6c646acee6a9b358d3dd1684997d223e52edc6e075f7d866035f37ae2e`.

The test template applies this file as a database migration before IntegreSQL finalizes it. It then applies `001-sdk-global-promise.sql`, a compatibility migration for published SDK 0.11.5: `ctx.promise()` carries `resonate:scope=global`, but this SQL revision does not classify that tag as externally awaitable. Without the patch, `task.suspend` can return 422 during recovery. The [SDK source fix](https://github.com/resonatehq/resonate-sdk-ts/commit/a3a3ccf3f92c636afcf51d4f10c4ad44d2b5399b) adds `resonate:external=true`; it has not reached the latest published SDK (0.11.5). Remove the migration once a published SDK includes that fix and the recovery test passes without it. IntegreSQL's `hashFiles` covers the SQL fixtures and image configuration. Update the upstream revision, fixture, migration, and compatibility tests together.

The image derives from the pinned official Postgres 16 Bookworm image and installs `postgresql-16-cron`; the IntegreSQL image is pinned by digest in `packages/testing/docker-compose.yml`. IntegreSQL's `hashFiles` covers the migration fixtures.
