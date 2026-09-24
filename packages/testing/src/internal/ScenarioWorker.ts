import { ResonateClient } from "@effect-resonate/core/ResonateClient"
import type * as ResonateClientModule from "@effect-resonate/core/ResonateClient"
import { Effect, Exit, Layer, ManagedRuntime, Option, Scope } from "effect"
import { ConformanceFailure, NetworkHarness, fail } from "../NetworkHarness.js"

export interface ScenarioWorker {
  readonly runExit: <Success, Error>(options: {
    readonly effect: Effect.Effect<Success, Error, ResonateClient>
  }) => Effect.Effect<
    Exit.Exit<Success, Error | ResonateClientModule.AcquisitionError>,
    ConformanceFailure,
    NetworkHarness
  >
}

export interface StartWorkerOptions {
  readonly scenario: string
  readonly executionIds?: ReadonlyArray<string>
  readonly layer: Layer.Layer<ResonateClient, ResonateClientModule.AcquisitionError>
}

const workerFailure = (options: StartWorkerOptions, issue: "WorkerFailed" | "CleanupFailed") =>
  fail({
    scenario: options.scenario,
    issue,
    assertion:
      issue === "WorkerFailed"
        ? "worker Layer must acquire and run without an unhandled failure"
        : "worker cleanup must complete",
    ...(options.executionIds === undefined ? {} : { executionIds: options.executionIds })
  })

export const startWorker = (
  options: StartWorkerOptions
): Effect.Effect<ScenarioWorker, ConformanceFailure, NetworkHarness | Scope.Scope> =>
  Effect.gen(function* () {
    const harness = yield* NetworkHarness
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => ManagedRuntime.make(options.layer)),
      (runtime) =>
        runtime.disposeEffect.pipe(
          Effect.catchCause(() => workerFailure(options, "CleanupFailed")),
          Effect.timeoutOption(harness.timing.scenarioTimeout),
          Effect.flatMap(
            Option.match({
              onNone: () => workerFailure(options, "CleanupFailed"),
              onSome: () => Effect.void
            })
          ),
          Effect.orDie
        )
    )
    const ready = yield* Effect.promise((signal) =>
      runtime.runPromiseExit(ResonateClient, { signal })
    ).pipe(
      Effect.timeoutOption(harness.timing.scenarioTimeout),
      Effect.flatMap(
        Option.match({
          onNone: () => workerFailure(options, "WorkerFailed"),
          onSome: Effect.succeed
        })
      )
    )
    yield* Exit.match(ready, {
      onFailure: () => workerFailure(options, "WorkerFailed"),
      onSuccess: () => Effect.void
    })

    return {
      runExit: ({ effect }) =>
        Effect.promise((signal) => runtime.runPromiseExit(effect, { signal })).pipe(
          Effect.timeoutOption(harness.timing.scenarioTimeout),
          Effect.flatMap(
            Option.match({
              onNone: () => workerFailure(options, "WorkerFailed"),
              onSome: Effect.succeed
            })
          )
        )
    } satisfies ScenarioWorker
  })
