import type { Network } from "@resonatehq/sdk"
import type { PostgresNetworkConfig } from "@resonatehq/sdk/postgres"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { Effect, Layer } from "effect"
import { layer } from "../index.js"
import { layer as subpathLayer } from "../PostgresNetwork.js"

const config: PostgresNetworkConfig = { connectionString: "postgres://localhost/db" }
const networkLayer = layer(config)
const clientLayer = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(
  Layer.provide(networkLayer)
)

declare const sdkNetwork: Network
ResonateNetwork.of({ make: Effect.succeed(sdkNetwork) })
subpathLayer(config)
void clientLayer

layer({
  connectionString: "postgres://localhost/db",
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
})
