import { assert, describe, it } from "@effect/vitest"
import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"
import { LocalNetwork } from "@resonatehq/sdk"
import { Context, Duration, Effect, Layer } from "effect"
import * as NetworkScenarios from "../NetworkScenarios.js"
import * as NetworkHarness from "../NetworkHarness.js"
import { replayRecovery, replayRecoveryScenario } from "../RecoveryScenarios.js"

interface LocalNetworkTestMetrics {
  readonly initializations: Array<null>
  readonly stops: Array<null>
}

interface LocalFixtureService {
  readonly network: LocalNetwork
  readonly resource: NetworkHarness.NetworkHarnessResource
}

class LocalFixture extends Context.Service<LocalFixture, LocalFixtureService>()(
  "@effect-resonate/testing/LocalFixture"
) {}

const fixtureLayer = (options: {
  readonly capabilities?: NetworkHarness.HarnessCapabilities
  readonly metrics?: LocalNetworkTestMetrics
  readonly scenarioTimeout?: Duration.Input
}): Layer.Layer<LocalFixture> =>
  Layer.effect(
    LocalFixture,
    Effect.acquireRelease(
      Effect.sync(() => {
        const metrics = options.metrics ?? { initializations: [], stops: [] }
        let activeWorkers = 0
        let stopPromise: Promise<void> | undefined
        class ObservedLocalNetwork extends LocalNetwork {
          override init(): Promise<void> {
            metrics.initializations.push(null)
            activeWorkers = 1
            stopPromise = undefined
            return super.init()
          }

          override stop(): Promise<void> {
            if (stopPromise === undefined) {
              metrics.stops.push(null)
              activeWorkers = 0
              stopPromise = super.stop()
            }
            return stopPromise
          }
        }
        const network = new ObservedLocalNetwork()
        return LocalFixture.of({
          network,
          resource: {
            timing: {
              pollInterval: Duration.millis(5),
              scenarioTimeout: options.scenarioTimeout ?? Duration.seconds(4)
            },
            capabilities: options.capabilities ?? {
              recovery: true,
              timeout: { invocationTimeoutMillis: 20 },
              invalidNonDurableAwait: true
            },
            observe: ({ executionIds }) =>
              Effect.succeed({
                phase: activeWorkers === 0 ? ("stopped" as const) : ("ready" as const),
                activeWorkers,
                executions: executionIds.map((id) => ({ id, state: "unknown" as const }))
              })
          }
        })
      }),
      (fixture) =>
        Effect.promise(() => fixture.network.stop()).pipe(
          Effect.timeout(options.scenarioTimeout ?? Duration.seconds(4)),
          Effect.orDie
        )
    )
  )

const makeLocalNetworkTestLayer = (options: {
  readonly capabilities?: NetworkHarness.HarnessCapabilities
  readonly metrics?: LocalNetworkTestMetrics
  readonly scenarioTimeout?: Duration.Input
}): Layer.Layer<
  NetworkHarness.NetworkHarness | ResonateNetwork.ResonateNetwork,
  NetworkHarness.HarnessSetupError
> => {
  const FixtureLive = fixtureLayer(options)
  const NetworkLive = Layer.effect(
    ResonateNetwork.ResonateNetwork,
    LocalFixture.use((fixture) =>
      Effect.succeed(ResonateNetwork.ResonateNetwork.of({ make: Effect.succeed(fixture.network) }))
    )
  )
  const HarnessLive = NetworkHarness.layer({
    name: "sdk-local",
    setupTimeout: options.scenarioTimeout ?? Duration.seconds(4),
    acquire: LocalFixture.use((fixture) => Effect.succeed(fixture.resource))
  })

  return Layer.merge(NetworkLive, HarnessLive).pipe(Layer.provide(FixtureLive))
}

const runWithLocalNetwork = (
  scenario: Effect.Effect<
    void,
    NetworkHarness.ConformanceFailure,
    NetworkHarness.NetworkHarness | ResonateNetwork.ResonateNetwork
  >
): Effect.Effect<void, NetworkHarness.ConformanceFailure> =>
  Effect.gen(function* () {
    const metrics = { initializations: [] as Array<null>, stops: [] as Array<null> }
    yield* scenario.pipe(Effect.provide(makeLocalNetworkTestLayer({ metrics })))
    assert.isAbove(metrics.initializations.length, 0)
    assert.strictEqual(metrics.stops.length, metrics.initializations.length)
  })

const expectMissingCapability = (options: {
  readonly scenario: Effect.Effect<
    void,
    NetworkHarness.ConformanceFailure,
    NetworkHarness.NetworkHarness | ResonateNetwork.ResonateNetwork
  >
  readonly scenarioName: string
  readonly assertion: string
}) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      options.scenario.pipe(Effect.provide(makeLocalNetworkTestLayer({ capabilities: {} })))
    )
    assert.deepInclude(failure, {
      issue: "MissingCapability",
      scenario: options.scenarioName,
      assertion: options.assertion
    })
  })

describe("SDK LocalNetwork conformance self-test", () => {
  it.live("completes a registered workflow containing an Effect step", () =>
    runWithLocalNetwork(NetworkScenarios.completion)
  )

  it.live("preserves first-writer-wins under duplicate activation", () =>
    runWithLocalNetwork(NetworkScenarios.duplicateActivation)
  )

  it.live("keeps checked failures, defects, and malformed input distinct", () =>
    runWithLocalNetwork(NetworkScenarios.failureClassification)
  )

  it.live("keeps durable execution alive after local cancellation", () =>
    runWithLocalNetwork(NetworkScenarios.cancellation)
  )

  it.live("prevents late resolution from replacing a durable timeout", () =>
    runWithLocalNetwork(NetworkScenarios.timeout)
  )

  it.live("supports repeated worker stop and restart", () =>
    runWithLocalNetwork(NetworkScenarios.lifecycle)
  )

  it.live(
    "rejects durable operations after an ordinary await",
    () => runWithLocalNetwork(NetworkScenarios.invalidNonDurableAwait),
    15_000
  )

  it.live(
    "reuses a checkpointed child after worker replacement",
    () => runWithLocalNetwork(replayRecovery),
    15_000
  )

  it.live("rejects the timeout scenario when timeout support is not declared", () =>
    expectMissingCapability({
      scenario: NetworkScenarios.timeout,
      scenarioName: NetworkScenarios.scenarioNames.timeout,
      assertion: "the provider must declare timeout support before registering this scenario"
    })
  )

  it.live("rejects the invalid-await scenario when closed-context support is not declared", () =>
    expectMissingCapability({
      scenario: NetworkScenarios.invalidNonDurableAwait,
      scenarioName: NetworkScenarios.scenarioNames.invalidNonDurableAwait,
      assertion: "the provider must declare closed-context support before registering this scenario"
    })
  )

  it.live("rejects the recovery scenario when recovery support is not declared", () =>
    expectMissingCapability({
      scenario: replayRecovery,
      scenarioName: replayRecoveryScenario,
      assertion: "the provider must declare recovery support before registering this scenario"
    })
  )
})
