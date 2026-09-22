import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as ResonateFunctions from "@effect-resonate/core/ResonateFunctions"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import * as Step from "@effect-resonate/core/Step"
import { StepContext } from "@effect-resonate/core/StepContext"
import * as Workflow from "@effect-resonate/core/Workflow"
import { Effect, Exit, Layer, Option, Result, Schema } from "effect"
import {
  assertConformance,
  type ConformanceFailure,
  fail,
  NetworkHarness,
  waitFor
} from "./NetworkHarness.js"
import { startWorker } from "./internal/ScenarioWorker.js"

export const replayRecoveryScenario = "replay-recovery"

const expectSuccess = <Success, Error>(options: {
  readonly scenario: string
  readonly assertion: string
  readonly executionIds: ReadonlyArray<string>
  readonly exit: Exit.Exit<Success, Error>
}): Effect.Effect<Success, ConformanceFailure, NetworkHarness> => Exit.match(options.exit, {
  onFailure: () => assertConformance({
    scenario: options.scenario,
    condition: false,
    assertion: options.assertion,
    executionIds: options.executionIds
  }).pipe(Effect.andThen(Effect.die("unreachable"))),
  onSuccess: Effect.succeed
})

/**
 * Proves that a checkpointed child is reused after one worker stops and a new
 * worker attaches to the same isolated durable state.
 */
export const replayRecovery: Effect.Effect<void, ConformanceFailure, NetworkHarness | ResonateNetwork> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = replayRecoveryScenario
  if (harness.capabilities.recovery !== true) {
    return yield* fail({
      scenario,
      issue: "MissingCapability",
      assertion: "the provider must declare recovery support before registering this scenario"
    })
  }

  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId, `${executionId}:0`, `${executionId}:1`]
  const attempts: Array<string> = []
  const Checkpoint = Step.make({
    name: `testing.${executionId}.checkpoint`,
    version: 1,
    input: Schema.Null,
    success: Schema.String,
    failure: Schema.Never
  })
  const Recover = Workflow.make({
    name: `testing.${executionId}.recover`,
    version: 1,
    input: Schema.Null,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Checkpoint, Recover)
  const dependencies = Layer.mergeAll(
    NetworkLive,
    Checkpoint.toLayer(() => Effect.gen(function*() {
      const context = yield* StepContext
      attempts.push(context.id)
      return "checkpointed"
    })),
    Recover.toLayer(async (context) => {
      const checkpoint = Result.getOrThrow(await context.run(Checkpoint, null))
      const resumed = await context.promise(Schema.String)
      return Result.succeed(`${checkpoint}:${resumed}`)
    })
  )
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(dependencies))

  yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const started = yield* worker.runExit({
      effect: ResonateClient.run(executionId, Recover, null)
    })
    yield* expectSuccess({
      scenario,
      assertion: "the first worker must activate the recovery workflow",
      executionIds,
      exit: started
    })
    yield* waitFor({
      scenario,
      assertion: "the first worker must durably checkpoint the child before stopping",
      executionIds,
      poll: worker.runExit({
        effect: ResonateClient.promises.get(`${executionId}:0`)
      }).pipe(Effect.map(Exit.match({
        onFailure: () => Option.none(),
        onSuccess: (record) => record.state === "resolved" ? Option.some(record) : Option.none()
      })))
    })
  }))

  const output = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    yield* waitFor({
      scenario,
      assertion: "the replacement worker must replay far enough to recreate the durable wait",
      executionIds,
      poll: worker.runExit({
        effect: ResonateClient.promises.get(`${executionId}:1`)
      }).pipe(Effect.map(Exit.match({
        onFailure: () => Option.none(),
        onSuccess: (record) => record.state === "pending" ? Option.some(record) : Option.none()
      })))
    })
    const resolved = yield* worker.runExit({
      effect: ResonateClient.promises.resolve(`${executionId}:1`, Schema.String, "resumed")
    })
    yield* expectSuccess({
      scenario,
      assertion: "the replacement worker must resolve the durable wait",
      executionIds,
      exit: resolved
    })
    const result = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const handle = yield* ResonateClient.get(executionId, Recover)
        return yield* handle.result()
      })
    })
    return yield* expectSuccess({
      scenario,
      assertion: "the replacement worker must attach and complete the original execution",
      executionIds,
      exit: result
    })
  }))

  yield* assertConformance({
    scenario,
    condition: output === "checkpointed:resumed",
    assertion: "recovery must preserve the workflow result",
    executionIds
  })
  yield* assertConformance({
    scenario,
    condition: attempts.length === 1 && new Set(attempts).size === 1,
    assertion: "a checkpointed child must not execute again after worker restart",
    executionIds
  })

  return yield* Effect.void
})
