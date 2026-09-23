import type { Network } from "@resonatehq/sdk"
import { Context, type Effect } from "effect"
import type { ResonateSdkError } from "./CoreExecutionError.js"

export interface ResonateNetworkService {
  /** Constructs one fresh, uninitialized network for a client Layer acquisition. */
  readonly make: Effect.Effect<Network, ResonateSdkError>
}

/** Provider-neutral network factory consumed by `ResonateClient.layer`. */
export class ResonateNetwork extends Context.Service<ResonateNetwork, ResonateNetworkService>()(
  "@effect-resonate/core/ResonateNetwork"
) {}
