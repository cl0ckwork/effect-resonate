import { PostgresNetwork, type PostgresNetworkConfig } from "@resonatehq/sdk/postgres"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import { Effect, Layer } from "effect"

/** Supplies a fresh official SDK network for each client Layer acquisition. */
export const layer = (config: PostgresNetworkConfig): Layer.Layer<ResonateNetwork> =>
  Layer.succeed(ResonateNetwork, ResonateNetwork.of({
    make: Effect.try({
      try: () => new PostgresNetwork(config),
      catch: (cause) => new ResonateSdkError({
        operation: "network.init",
        cause,
        requestMayHaveCommitted: false
      })
    })
  }))
