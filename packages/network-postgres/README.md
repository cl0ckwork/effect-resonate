# @effect-resonate/network-postgres

This package supplies the official Resonate SDK `PostgresNetwork` as an Effect
Layer. Install it with core, Effect, the Resonate SDK, and the PostgreSQL driver:

```sh
pnpm add @effect-resonate/core @effect-resonate/network-postgres effect @resonatehq/sdk pg
```

Set `DATABASE_URL` to a PostgreSQL connection string, then provide the network
Layer to `ResonateClient.layer`. Effect Config reports a missing variable when
the Layer is acquired:

```ts
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Config, Effect, Layer, Redacted } from "effect"

const NetworkLive = Layer.unwrap(
  Config.Redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      PostgresNetwork.layer({
        connectionString: Redacted.value(url),
        group: "workers"
      })
    )
  )
)

const ClientLive = ResonateClient.layer({ drainTimeout: "30 seconds" }).pipe(
  Layer.provide(NetworkLive)
)
```

Pass the official `PostgresNetworkConfig`, including its optional logger,
unchanged to `PostgresNetwork.layer`. The Layer constructs a fresh, uninitialized
SDK network for each client acquisition. Core owns initialization, readiness,
and shutdown, including cleanup after partial acquisition. The provider does
not modify SDK errors, diagnostics, logging, or retry behavior.

## Database setup

Provision the Resonate PostgreSQL schema and the `pg_cron` extension before
starting a client. This package does not run migrations or create database
objects. Follow the setup instructions for the version of the
[Resonate TypeScript SDK](https://docs.resonatehq.io/develop/typescript) in use.

Database-backed provider conformance tests and their pinned SQL fixtures live
in the private [`@effect-resonate/testing`](../testing/README.md) package; they
are not production migrations.
