import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as ResonateFunctions from "@effect-resonate/core/ResonateFunctions"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import * as Step from "@effect-resonate/core/Step"
import * as Workflow from "@effect-resonate/core/Workflow"
import { Effect, Exit, Fiber, Layer, Match, Option, Result, Schedule, Schema } from "effect"
import {
  assertConformance,
  type ConformanceFailure,
  fail,
  NetworkHarness,
  waitFor
} from "./NetworkHarness.js"
import { startWorker } from "./internal/ScenarioWorker.js"

export const scenarioNames = {
  completion: "completion",
  duplicateActivation: "duplicate-activation",
  failureClassification: "failure-classification",
  cancellation: "cancellation",
  timeout: "timeout",
  lifecycle: "lifecycle",
  invalidNonDurableAwait: "invalid-non-durable-await"
} as const

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

const isTagged = (options: { readonly value: unknown; readonly tag: string }): boolean => Match.value(options.value).pipe(
  Match.when({ _tag: options.tag }, () => true),
  Match.orElse(() => false)
)

export const completion: Effect.Effect<void, ConformanceFailure, NetworkHarness | ResonateNetwork> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.completion
  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId]
  const Uppercase = Step.make({
    name: `testing.${executionId}.uppercase`,
    version: 1,
    input: Schema.String,
    success: Schema.String,
    failure: Schema.Never
  })
  const Echo = Workflow.make({
    name: `testing.${executionId}.echo`,
    version: 1,
    input: Schema.String,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Uppercase, Echo)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.mergeAll(
    NetworkLive,
    Uppercase.toLayer((input) => Effect.succeed(input.toUpperCase())),
    Echo.toLayer(async (context, input) => context.run(Uppercase, input))
  )))
  const output = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const exit = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const handle = yield* ResonateClient.run(executionId, Echo, "portable")
        return yield* handle.result()
      })
    })
    return yield* expectSuccess({
      scenario,
      assertion: "a registered workflow and Effect step must complete",
      executionIds,
      exit
    })
  }))
  yield* assertConformance({
    scenario,
    condition: output === "PORTABLE",
    assertion: "completion must preserve the decoded step result",
    executionIds
  })
  return yield* Effect.void
})

export const duplicateActivation: Effect.Effect<void, ConformanceFailure, NetworkHarness | ResonateNetwork> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.duplicateActivation
  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId, `${executionId}:0`]
  const First = Workflow.make({
    name: `testing.${executionId}.first`,
    version: 1,
    input: Schema.String,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(First)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.merge(
    NetworkLive,
    First.toLayer(async (context, input) => {
      await context.promise(Schema.Null)
      return Result.succeed(input)
    })
  )))

  const outputs = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const activation = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const first = yield* ResonateClient.run(executionId, First, "first")
        const duplicate = yield* ResonateClient.run(executionId, First, "second")
        return [first, duplicate] as const
      })
    })
    const [first, duplicate] = yield* expectSuccess({
      scenario,
      assertion: "both same-id activations must return handles",
      executionIds,
      exit: activation
    })
    yield* waitFor({
      scenario,
      assertion: "the first activation must create its durable wait",
      executionIds,
      poll: worker.runExit({
        effect: ResonateClient.promises.get(`${executionId}:0`)
      }).pipe(Effect.map(Exit.match({
        onFailure: () => Option.none(),
        onSuccess: (record) => record.state === "pending" ? Option.some(record) : Option.none()
      })))
    })
    const settlement = yield* worker.runExit({
      effect: ResonateClient.promises.resolve(`${executionId}:0`, Schema.Null, null)
    })
    yield* expectSuccess({
      scenario,
      assertion: "the duplicate activation's shared durable wait must resolve",
      executionIds,
      exit: settlement
    })
    const result = yield* worker.runExit({
      effect: Effect.all([first.result(), duplicate.result()])
    })
    return yield* expectSuccess({
      scenario,
      assertion: "both same-id handles must observe the original result",
      executionIds,
      exit: result
    })
  }))

  yield* assertConformance({
    scenario,
    condition: outputs[0] === "first" && outputs[1] === "first",
    assertion: "duplicate activation must preserve Resonate first-writer-wins semantics",
    executionIds
  })
  return yield* Effect.void
})

export const failureClassification: Effect.Effect<
  void,
  ConformanceFailure,
  NetworkHarness | ResonateNetwork
> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.failureClassification
  const checkedId = yield* harness.nextExecutionId({ scenario: `${scenario}-checked` })
  const defectId = yield* harness.nextExecutionId({ scenario: `${scenario}-defect` })
  const invalidId = yield* harness.nextExecutionId({ scenario: `${scenario}-invalid` })
  const executionIds = [checkedId, defectId, invalidId]
  const Decline = Workflow.make({
    name: `testing.${checkedId}.decline`,
    version: 1,
    input: Schema.Null,
    success: Schema.Never,
    failure: Schema.Struct({ reason: Schema.String })
  })
  const Broken = Step.make({
    name: `testing.${defectId}.broken`,
    version: 1,
    input: Schema.Null,
    success: Schema.Never,
    failure: Schema.Never
  })
  const Defect = Workflow.make({
    name: `testing.${defectId}.defect`,
    version: 1,
    input: Schema.Null,
    success: Schema.Never,
    failure: Schema.Never
  })
  const Validated = Workflow.make({
    name: `testing.${invalidId}.validated`,
    version: 1,
    input: Schema.String,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Decline, Broken, Defect, Validated)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.mergeAll(
    NetworkLive,
    Decline.toLayer(async () => Result.fail({ reason: "declined" })),
    Broken.toLayer(() => Effect.die(new TypeError("private defect detail"))),
    Defect.toLayer(async (context) => context.run(Broken, null)),
    Validated.toLayer(async (_context, input) => Result.succeed(input))
  )))

  const [checked, defect, invalid] = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const exit = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const checkedHandle = yield* ResonateClient.run(checkedId, Decline, null)
        const defectHandle = yield* ResonateClient.run(defectId, Defect, null)
        const checked = yield* Effect.flip(checkedHandle.result())
        const defect = yield* Effect.flip(defectHandle.result())
        const rawOptions = yield* ResonateClient.options({ version: Validated.version })
        const rawHandle = yield* ResonateClient.run(invalidId, Validated.name, { malformed: true }, rawOptions)
        yield* rawHandle.result()
        const invalidHandle = yield* ResonateClient.get(invalidId, Validated)
        const invalid = yield* Effect.flip(invalidHandle.result())
        return [checked, defect, invalid] as const
      })
    })
    return yield* expectSuccess({
      scenario,
      assertion: "checked failures and defects must both remain observable",
      executionIds,
      exit
    })
  }))

  yield* assertConformance({
    scenario,
    condition: Match.value(checked).pipe(
      Match.when({ reason: "declined" }, () => true),
      Match.orElse(() => false)
    ),
    assertion: "a checked workflow failure must remain domain data",
    executionIds
  })
  yield* assertConformance({
    scenario,
    condition: isTagged({ value: defect, tag: "@effect-resonate/core/ExecutionRejected" }),
    assertion: "a defect must not be reported as the checked domain failure",
    executionIds
  })
  yield* assertConformance({
    scenario,
    condition: isTagged({ value: invalid, tag: "@effect-resonate/core/InvalidWorkflowInput" }),
    assertion: "malformed persisted input must remain distinct from domain failure and defect",
    executionIds
  })
  return yield* Effect.void
})

export const cancellation: Effect.Effect<void, ConformanceFailure, NetworkHarness | ResonateNetwork> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.cancellation
  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId, `${executionId}:0`]
  let notifyWaiting!: () => void
  const waiting = new Promise<void>((resolve) => {
    notifyWaiting = resolve
  })
  const Wait = Workflow.make({
    name: `testing.${executionId}.wait`,
    version: 1,
    input: Schema.Null,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Wait)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.merge(
    NetworkLive,
    Wait.toLayer(async (context) => {
      const durable = context.promise(Schema.String)
      notifyWaiting()
      return Result.succeed(await durable)
    })
  )))
  const output = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const exit = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const handle = yield* ResonateClient.run(executionId, Wait, null)
        const localWaiter = yield* handle.result().pipe(Effect.forkChild)
        yield* Effect.promise(() => waiting)
        yield* Fiber.interrupt(localWaiter)
        yield* ResonateClient.promises.resolve(`${executionId}:0`, Schema.String, "still-running").pipe(
          Effect.retry(Schedule.spaced(harness.timing.pollInterval))
        )
        const attached = yield* ResonateClient.get(executionId, Wait)
        return yield* attached.result()
      })
    })
    return yield* expectSuccess({
      scenario,
      assertion: "interrupting a local waiter must not cancel durable execution",
      executionIds,
      exit
    })
  }))
  yield* assertConformance({
    scenario,
    condition: output === "still-running",
    assertion: "a fresh attachment must observe completion after local cancellation",
    executionIds
  })
  return yield* Effect.void
})

export const timeout: Effect.Effect<void, ConformanceFailure, NetworkHarness | ResonateNetwork> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.timeout
  const capability = harness.capabilities.timeout
  if (capability === undefined) {
    return yield* fail({
      scenario,
      issue: "MissingCapability",
      assertion: "the provider must declare timeout support before registering this scenario"
    })
  }
  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId, `${executionId}:0`]
  const Wait = Workflow.make({
    name: `testing.${executionId}.timeout`,
    version: 1,
    input: Schema.Null,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Wait)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.merge(
    NetworkLive,
    Wait.toLayer(async (context) => Result.succeed(await context.promise(Schema.String)))
  )))

  const [failure, state] = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const exit = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const handle = yield* ResonateClient.run(executionId, Wait, null, {
          timeout: capability.invocationTimeoutMillis
        })
        const failure = yield* Effect.flip(handle.result())
        yield* ResonateClient.promises.resolve(`${executionId}:0`, Schema.String, "late")
        const record = yield* ResonateClient.promises.get(executionId)
        return [failure, record.state] as const
      })
    })
    return yield* expectSuccess({
      scenario,
      assertion: "a durable timeout must settle within the harness deadline",
      executionIds,
      exit
    })
  }))

  yield* assertConformance({
    scenario,
    condition: isTagged({ value: failure, tag: "@effect-resonate/core/ResonateSdkError" }),
    assertion: "timeout must remain an SDK execution failure rather than a domain failure",
    executionIds
  })
  yield* assertConformance({
    scenario,
    condition: state === "rejected_timedout",
    assertion: "late resolution must not replace the durable timeout state",
    executionIds
  })
  return yield* Effect.void
})

export const lifecycle: Effect.Effect<void, ConformanceFailure, NetworkHarness | ResonateNetwork> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.lifecycle
  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId]
  const Ping = Workflow.make({
    name: `testing.${executionId}.ping`,
    version: 1,
    input: Schema.Null,
    success: Schema.String,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Ping)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.merge(
    NetworkLive,
    Ping.toLayer(async () => Result.succeed("pong"))
  )))

  yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const stopped = yield* worker.runExit({
      effect: Effect.gen(function*() {
        yield* ResonateClient.stop()
        yield* ResonateClient.stop()
      })
    })
    yield* expectSuccess({
      scenario,
      assertion: "explicit worker stop must be idempotent",
      executionIds,
      exit: stopped
    })
  }))

  const output = yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const exit = yield* worker.runExit({
      effect: Effect.gen(function*() {
        const handle = yield* ResonateClient.run(executionId, Ping, null)
        return yield* handle.result()
      })
    })
    return yield* expectSuccess({
      scenario,
      assertion: "a worker must start cleanly after a prior worker stopped repeatedly",
      executionIds,
      exit
    })
  }))
  yield* assertConformance({
    scenario,
    condition: output === "pong",
    assertion: "repeated worker lifecycle must leave the isolated state usable",
    executionIds
  })
  return yield* Effect.void
})

export const invalidNonDurableAwait: Effect.Effect<
  void,
  ConformanceFailure,
  NetworkHarness | ResonateNetwork
> = Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const NetworkLive = Layer.succeed(ResonateNetwork, yield* ResonateNetwork)
  const scenario = scenarioNames.invalidNonDurableAwait
  if (harness.capabilities.invalidNonDurableAwait !== true) {
    return yield* fail({
      scenario,
      issue: "MissingCapability",
      assertion: "the provider must declare closed-context support before registering this scenario"
    })
  }
  const executionId = yield* harness.nextExecutionId({ scenario })
  const executionIds = [executionId, `${executionId}:0`]
  const attempts: Array<null> = []
  let releaseOrdinaryWait!: () => void
  const ordinaryWait = new Promise<void>((resolve) => {
    releaseOrdinaryWait = resolve
  })
  let notifyRejected!: () => void
  const lateOperationRejected = new Promise<void>((resolve) => {
    notifyRejected = resolve
  })
  const Late = Step.make({
    name: `testing.${executionId}.late`,
    version: 1,
    input: Schema.Null,
    success: Schema.Null,
    failure: Schema.Never
  })
  const Invalid = Workflow.make({
    name: `testing.${executionId}.invalid-await`,
    version: 1,
    input: Schema.Null,
    success: Schema.Null,
    failure: Schema.Never
  })
  const Functions = ResonateFunctions.make(Late, Invalid)
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: harness.timing.scenarioTimeout
  }).pipe(Layer.provide(Layer.mergeAll(
    NetworkLive,
    Late.toLayer(() => Effect.sync(() => {
      attempts.push(null)
      return null
    })),
    Invalid.toLayer(async (context) => {
      context.promise(Schema.Null)
      await ordinaryWait
      try {
        return await context.run(Late, null)
      } catch {
        notifyRejected()
        return Result.succeed(null)
      }
    })
  )))

  yield* Effect.scoped(Effect.gen(function*() {
    const worker = yield* startWorker({ scenario, executionIds, layer: ClientLive })
    const running = yield* worker.runExit({
      effect: Effect.gen(function*() {
        yield* ResonateClient.run(executionId, Invalid, null)
        yield* Effect.promise(() => lateOperationRejected)
      })
    }).pipe(Effect.forkScoped)
    yield* waitFor({
      scenario,
      assertion: "the durable wait must suspend and close the workflow execution pass",
      executionIds,
      poll: worker.runExit({
        effect: ResonateClient.promises.get(`${executionId}:0`)
      }).pipe(Effect.map(Exit.match({
        onFailure: () => Option.none(),
        onSuccess: (record) => record.state === "pending" ? Option.some(record) : Option.none()
      })))
    })
    yield* Effect.sync(releaseOrdinaryWait)
    const exit = yield* Fiber.join(running)
    yield* expectSuccess({
      scenario,
      assertion: "the SDK closed-context guard must reject the late durable operation",
      executionIds,
      exit
    })
  }))

  yield* assertConformance({
    scenario,
    condition: attempts.length === 0,
    assertion: "the late durable step must never execute",
    executionIds
  })
  return yield* Effect.void
})
