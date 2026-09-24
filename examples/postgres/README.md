# PostgreSQL example

This runnable example starts a local PostgreSQL database, applies the Resonate
schema, and runs a simple workflow followed by an evolved version. Run commands
from `examples/postgres` after `pnpm install` and `pnpm build` at the repository
root. Node.js 22 or newer, Docker Compose, and `pnpm` are required.

## 1. Start and bootstrap PostgreSQL

```sh
cd examples/postgres
docker compose up -d --wait
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 \
  -U effect_resonate_example -d effect_resonate_example \
  < ../../packages/testing/src/postgres/docker/fixtures/resonate.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 \
  -U effect_resonate_example -d effect_resonate_example \
  < ../../packages/testing/src/postgres/docker/fixtures/001-sdk-global-promise.sql
docker compose exec postgres psql -U effect_resonate_example \
  -d effect_resonate_example -Atc 'SELECT resonate.get_schema_version()'
```

The last command should print `0.1.0`. The Compose image includes `pg_cron`,
preloads it, and points its scheduler at `effect_resonate_example`, the same
database that receives the schema. The SQL is the repository's pinned
[`resonate-pg` fixture](../../packages/testing/src/postgres/docker/fixtures/UPSTREAM.md).
The second SQL file is a compatibility migration for the pinned SDK. These
files serve this local example; plan and version production migrations
separately.

If port 55432 is in use, change the host-side port in `compose.yaml` and set
`DATABASE_URL` accordingly before running the app.

## 2. Run the workflows

```sh
pnpm build
pnpm start
```

Expected results are `v1: HELLO` and `v2: { value: 'GRÜSSE', length: 6 }`.
Each run receives a new execution ID. Reusing an ID addresses the same durable
execution rather than submitting new input.

[`src/main.ts`](src/main.ts) shows the two boundaries: the workflow uses
`context.run` for durable orchestration, and each registered step runs an
Effect program. V2 changes the step input and result and the workflow contract.
Both versions retain the same registered names with distinct version numbers,
and both handlers stay registered so existing V1 executions can finish.

The example runs a client and worker together until both results arrive. A
deployed service should keep workers running after callers disconnect so that
durable executions can continue or recover.

To stop the local database:

```sh
docker compose down
```

`docker compose down -v` also removes its data volume and all executions.
