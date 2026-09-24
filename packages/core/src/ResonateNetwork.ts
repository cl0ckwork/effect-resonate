import type { Network } from "@resonatehq/sdk"
import { Context, Effect, Layer } from "effect"
import { ResonateSdkError } from "./CoreExecutionError.js"

export interface ResonateNetworkService {
  /** Constructs one fresh, uninitialized network for a client Layer acquisition. */
  readonly make: Effect.Effect<Network, ResonateSdkError>
}

/** Provider-neutral network factory consumed by `ResonateClient.layer`. */
export class ResonateNetwork extends Context.Service<ResonateNetwork, ResonateNetworkService>()(
  "@effect-resonate/core/ResonateNetwork"
) {}

/** Creates a fresh SDK network for each client acquisition. */
export const layer = (factory: () => Network): Layer.Layer<ResonateNetwork> =>
  Layer.succeed(
    ResonateNetwork,
    ResonateNetwork.of({
      make: Effect.try({
        try: factory,
        catch: (cause) =>
          new ResonateSdkError({
            operation: "network.init",
            cause,
            requestMayHaveCommitted: false
          })
      })
    })
  )
