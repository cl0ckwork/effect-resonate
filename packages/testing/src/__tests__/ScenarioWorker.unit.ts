import { assert, describe, it } from "@effect/vitest"
import { ResonateClient } from "@effect-resonate/core/ResonateClient"
import { Cause, Duration, Effect, Exit, Layer, Result } from "effect"
import * as NetworkHarness from "../NetworkHarness.js"
import { startWorker } from "../internal/ScenarioWorker.js"

const HarnessLive = NetworkHarness.layer({
  name: "scenario-worker-unit",
  setupTimeout: Duration.seconds(1),
  acquire: Effect.succeed({
    timing: {
      pollInterval: Duration.millis(1),
      scenarioTimeout: Duration.millis(20)
    },
    capabilities: {},
    observe: ({ executionIds }: NetworkHarness.ObservationRequest) => Effect.succeed({
      phase: "stopped" as const,
      activeWorkers: 0,
      executions: executionIds.map((id) => ({ id, state: "unknown" as const }))
    })
  })
})

const emptyClient = ResonateClient.of(Object.create(null))

describe("ScenarioWorker", () => {
  it("releases partially acquired resources when worker startup times out", async () => {
    let releases = 0
    const HangingWorker = Layer.effect(
      ResonateClient,
      Effect.acquireRelease(
        Effect.succeed(null),
        () => Effect.sync(() => {
          releases += 1
        })
      ).pipe(Effect.andThen(Effect.never))
    )

    const failure = await Effect.runPromise(Effect.flip(
      Effect.scoped(startWorker({
        scenario: "startup-timeout",
        layer: HangingWorker
      })).pipe(Effect.provide(HarnessLive))
    ))

    assert.strictEqual(failure.issue, "WorkerFailed")
    assert.strictEqual(releases, 1)
  })

  it("interrupts timed-out worker operations before leaving the worker scope", async () => {
    let interruptions = 0
    let releases = 0
    const ReadyWorker = Layer.effect(
      ResonateClient,
      Effect.acquireRelease(
        Effect.succeed(emptyClient),
        () => Effect.sync(() => {
          releases += 1
        })
      )
    )

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const worker = yield* startWorker({
        scenario: "operation-timeout",
        layer: ReadyWorker
      })
      const failure = yield* Effect.flip(worker.runExit({
        effect: Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => {
          interruptions += 1
        })))
      }))
      return { failure, interruptionsBeforeCleanup: interruptions }
    })).pipe(Effect.provide(HarnessLive)))

    assert.strictEqual(result.failure.issue, "WorkerFailed")
    assert.strictEqual(result.interruptionsBeforeCleanup, 1)
    assert.strictEqual(releases, 1)
  })

  it("sanitizes worker cleanup defects", async () => {
    const secret = "postgres://cleanup-secret@example.invalid/database"
    const FailingCleanup = Layer.effect(
      ResonateClient,
      Effect.acquireRelease(
        Effect.succeed(emptyClient),
        () => Effect.die(new Error(secret))
      )
    )

    const exit = await Effect.runPromise(Effect.exit(
      Effect.scoped(startWorker({
        scenario: "cleanup-failure",
        layer: FailingCleanup
      })).pipe(Effect.provide(HarnessLive))
    ))

    assert.isTrue(Exit.isFailure(exit))
    if (Exit.isFailure(exit)) {
      const defect = Result.getOrThrow(Cause.findDefect(exit.cause))
      assert.deepInclude(defect, {
        _tag: "@effect-resonate/testing/ConformanceFailure",
        issue: "CleanupFailed",
        scenario: "cleanup-failure"
      })
      assert.notInclude(JSON.stringify(defect), secret)
    }
  })
})
