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

The connection string must be nonblank. Optional `group`, `pid`, and `tickMs` use the SDK's semantics; `tickMs`, when supplied, must be a positive integer no greater than `2_147_483_647`. The package passes the connection string through to the SDK without parsing or normalizing it. Each client acquisition creates a fresh network; core initializes and stops it.

The provider sanitizes network errors before they reach core. You may supply the SDK's `logger` interface; it is passed directly to the SDK and receives the SDK's original fields and messages, which can include database error text. The operator must provision the Resonate Postgres schema. Database-backed conformance is covered by the separate U7 runtime app.
