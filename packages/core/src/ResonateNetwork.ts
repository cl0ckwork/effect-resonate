import type { Resonate } from "@resonatehq/sdk/async"
import { Context, Effect, Layer } from "effect"
import type { ResonateSdkError } from "./CoreExecutionError.js"

type ResonateOptions = NonNullable<ConstructorParameters<typeof Resonate>[0]>

/** The network accepted by the public async Resonate constructor. */
export type CompatibleNetwork = NonNullable<ResonateOptions["network"]>

export interface ResonateNetworkService {
  /** Constructs one fresh, uninitialized network for a client Layer acquisition. */
  readonly make: Effect.Effect<CompatibleNetwork, ResonateSdkError>
}

/** Provider-neutral network factory consumed by `ResonateClient.layer`. */
export class ResonateNetwork extends Context.Service<ResonateNetwork, ResonateNetworkService>()(
  "@effect-resonate/core/ResonateNetwork"
) {}

export interface MakeOptions<R> {
  readonly factory: Effect.Effect<CompatibleNetwork, ResonateSdkError, R>
}

/**
 * Builds a provider Layer while retaining the factory's Effect requirements.
 * Core, rather than the provider, owns network initialization and shutdown.
 */
export const make = <R>(options: MakeOptions<R>): Layer.Layer<ResonateNetwork, never, R> => Layer.effect(
  ResonateNetwork,
  Effect.context<R>().pipe(
    Effect.map((services) => ResonateNetwork.of({
      make: options.factory.pipe(
        Effect.provide(services)
      )
    }))
  )
)
