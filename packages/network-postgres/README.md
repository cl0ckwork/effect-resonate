# @effect-resonate/network-postgres

Effect Layer for the official Resonate SDK `PostgresNetwork`.

Install this package alongside `@effect-resonate/core`, `effect`, `@resonatehq/sdk`, and `pg`. Provide its Layer to `ResonateClient.layer`:

```ts
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Layer } from "effect"

const ClientLive = ResonateClient.layer({ drainTimeout: "30 seconds" }).pipe(
  Layer.provide(PostgresNetwork.layer({
    connectionString: process.env.DATABASE_URL ?? "",
    group: "workers"
  }))
)
```

The package passes the official SDK configuration, including an optional `logger`, directly to `PostgresNetwork`. Each client acquisition creates a fresh network; core initializes and stops it.

SDK errors retain their original causes and diagnostics. The operator must provision the Resonate Postgres schema. Database-backed conformance lives in `@effect-resonate/testing`.
