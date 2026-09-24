import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Option } from "effect"
import * as NetworkHarness from "../NetworkHarness.js"

const makeUnitHarness = (options: {
  readonly observationDefect?: unknown
  readonly scenarioTimeout?: Duration.Input
}) =>
  NetworkHarness.layer({
    name: "unit",
    setupTimeout: options.scenarioTimeout ?? Duration.seconds(1),
    acquire: Effect.succeed({
      timing: {
        pollInterval: Duration.millis(5),
        scenarioTimeout: options.scenarioTimeout ?? Duration.seconds(1)
      },
      capabilities: {},
      observe: ({ executionIds }: NetworkHarness.ObservationRequest) =>
        options.observationDefect === undefined
          ? Effect.succeed({
              phase: "stopped" as const,
              activeWorkers: 0,
              executions: executionIds.map((id) => ({ id, state: "unknown" as const }))
            })
          : Effect.die(options.observationDefect)
    })
  })

describe("NetworkHarness", () => {
  it("assigns isolated execution ids and begins with empty structural observations", async () => {
    const program = Effect.gen(function* () {
      const harness = yield* NetworkHarness.NetworkHarness
      const first = yield* harness.nextExecutionId({ scenario: "identity" })
      const second = yield* harness.nextExecutionId({ scenario: "identity" })
      const observation = yield* harness.observe({ executionIds: [] })
      return { first, second, observation }
    }).pipe(Effect.provide(makeUnitHarness({})))

    const result = await Effect.runPromise(program)
    assert.notStrictEqual(result.first, result.second)
    assert.deepStrictEqual(result.observation.executions, [])
  })

  it("releases earlier setup when a later acquisition step fails and sanitizes the error", async () => {
    let releases = 0
    const secret = "postgres://secret@example.invalid/database"
    const Failing = NetworkHarness.layer({
      name: "failing-provider",
      setupTimeout: Duration.seconds(1),
      acquire: Effect.acquireRelease(Effect.succeed(null), () =>
        Effect.sync(() => {
          releases += 1
        })
      ).pipe(Effect.andThen(Effect.fail(new Error(secret))))
    })

    const failure = await Effect.runPromise(
      Effect.flip(NetworkHarness.NetworkHarness.pipe(Effect.provide(Failing)))
    )

    assert.strictEqual(releases, 1)
    assert.deepInclude(failure, {
      _tag: "@effect-resonate/testing/HarnessSetupError",
      harness: "failing-provider",
      issue: "AcquisitionFailed"
    })
    assert.notInclude(JSON.stringify(failure), secret)
  })

  it("bounds polling and reports only structured diagnostics", async () => {
    const secret = "postgres://diagnostic-secret@example.invalid/database"
    const failure = await Effect.runPromise(
      Effect.flip(
        NetworkHarness.waitFor({
          scenario: "bounded-poll",
          assertion: "the observation must eventually appear",
          executionIds: ["safe-id"],
          poll: Effect.succeed(Option.none<never>())
        }).pipe(
          Effect.provide(
            makeUnitHarness({
              observationDefect: new Error(secret),
              scenarioTimeout: Duration.millis(20)
            })
          )
        )
      )
    )

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/testing/ConformanceFailure",
      scenario: "bounded-poll",
      issue: "TimedOut",
      assertion: "the observation must eventually appear"
    })
    assert.deepStrictEqual(failure.observation.executions, [{ id: "safe-id", state: "unknown" }])
    assert.strictEqual(failure.observation.phase, "unknown")
    assert.notInclude(JSON.stringify(failure), secret)
  })
})
