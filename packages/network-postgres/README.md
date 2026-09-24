# @effect-resonate/network-postgres

Effect Layer for the official Resonate SDK `PostgresNetwork`. After the first
npm release, install it with
core, Effect, the Resonate SDK, and the PostgreSQL driver:

```sh
pnpm add @effect-resonate/core @effect-resonate/network-postgres effect @resonatehq/sdk pg
```

Provide the network Layer to `ResonateClient.layer`:

```ts
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Layer } from "effect"

const ClientLive = ResonateClient.layer({ drainTimeout: "30 seconds" }).pipe(
  Layer.provide(
    PostgresNetwork.layer({
      connectionString: process.env.DATABASE_URL ?? "",
      group: "workers"
    })
  )
)
```

Pass the official `PostgresNetworkConfig`, including its optional logger,
unchanged to `PostgresNetwork.layer`. The Layer constructs a fresh, uninitialized
SDK network for each client acquisition. Core owns initialization, readiness,
and shutdown, including cleanup after partial acquisition. The provider does
not modify SDK errors, diagnostics, logging, or retry behavior.

## Database setup

The operator must provision the Resonate PostgreSQL schema and the `pg_cron`
extension required by the official SDK. This package does not run migrations or
create database objects. Follow the setup instructions for the version of the
[Resonate TypeScript SDK](https://docs.resonatehq.io/develop/typescript) in use.

Database-backed provider conformance tests and their pinned SQL fixtures live
in the private [`@effect-resonate/testing`](../testing/README.md) package; they
are not production migrations.
