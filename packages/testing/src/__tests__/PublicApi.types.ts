import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"
import type { Network } from "@resonatehq/sdk"
import { Effect, Layer } from "effect"
import {
  completion,
  makeNetworkHarnessLayer,
  type NetworkHarnessResource,
  type ObservationRequest,
  replayRecovery
} from "../index.js"

declare const compatibleNetwork: Network

const resource = {
  timing: {
    pollInterval: 10,
    scenarioTimeout: 1_000
  },
  capabilities: {
    recovery: true,
    timeout: { invocationTimeoutMillis: 100 },
    invalidNonDurableAwait: true
  },
  observe: ({ executionIds }: ObservationRequest) => Effect.succeed({
    phase: "ready" as const,
    activeWorkers: 0,
    executions: executionIds.map((id) => ({ id, state: "unknown" as const }))
  })
} satisfies NetworkHarnessResource

const HarnessLive = makeNetworkHarnessLayer({
  name: "future-provider",
  setupTimeout: 1_000,
  acquire: Effect.succeed(resource)
})
const NetworkLive = Layer.succeed(
  ResonateNetwork.ResonateNetwork,
  ResonateNetwork.ResonateNetwork.of({ make: Effect.succeed(compatibleNetwork) })
)
const ProviderLive = Layer.merge(HarnessLive, NetworkLive)

completion.pipe(Effect.provide(ProviderLive))
replayRecovery.pipe(Effect.provide(ProviderLive))

// @ts-expect-error provider implementation details are not harness capabilities
const _providerDetail = resource.postgresUrl

// @ts-expect-error a harness without ResonateNetwork cannot run a conformance scenario
Effect.runPromise(completion.pipe(Effect.provide(HarnessLive)))
