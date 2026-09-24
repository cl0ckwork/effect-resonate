import { assert, describe, it } from "@effect/vitest"
import type { Info } from "@resonatehq/sdk/async"
import { Cause, Context, Effect, Layer, ManagedRuntime, Schema } from "effect"
import * as Step from "../../Step.js"
import { StepContext } from "../../StepContext.js"
import { AdapterSupervisor } from "../AdapterSupervisor.js"
import * as DurableOutcome from "../DurableOutcome.js"
import * as StepAdapter from "../StepAdapter.js"

const info: Info = {
  id: "order-42:1",
  parentId: "order-42",
  originId: "order-42",
  branchId: "order-42",
  timeoutAt: 10_000,
  attempt: 2,
  version: 1,
  func: "inventory.reserve",
  getDependency: () => undefined
}

const makeRuntime = <Definition extends Step.Any, R>(
  definition: Definition,
  execute: (input: Step.Step.Input<Definition>) => Effect.Effect<
    Step.Step.Success<Definition>,
    Step.Step.Failure<Definition>,
    R
  >
) => ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, definition.toLayer(execute)))

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
    assert.fail("expected promise rejection")
  } catch (cause) {
    return cause
  }
}

const expectReason = async (
  promise: Promise<unknown>,
  reason: string
): Promise<void> => {
  assert.deepInclude(await rejectionOf(promise), {
    _tag: "@effect-resonate/core/ExecutionRejected",
    executionId: info.id,
    reason
  })
}

describe("StepAdapter", () => {
  it("runs a successful step with immutable invocation metadata", async () => {
    const definition = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.Struct({
        id: Schema.String,
        attempt: Schema.Number,
        func: Schema.String,
        dependency: Schema.String,
        frozen: Schema.Boolean
      }),
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.gen(function*() {
        const context = yield* StepContext
        return {
          id: context.id,
          attempt: context.attempt,
          func: context.func,
          dependency: context.getDependency<string>("region") ?? "missing",
          frozen: Object.isFrozen(context)
        }
      }))
    await runtime.context()

    const result = await StepAdapter.make(definition, runtime.runPromise)({
      ...info,
      getDependency: (key) => key === "region" ? "us-east-1" : undefined
    }, { sku: "sku-1" })

    assert.deepStrictEqual(result, DurableOutcome.success(DurableOutcome.identityOf(definition), {
      id: info.id,
      attempt: 2,
      func: info.func,
      dependency: "us-east-1",
      frozen: true
    }))
    await runtime.dispose()
  })

  it("inherits application services from the managed runtime", async () => {
    class Inventory extends Context.Service<Inventory, string>()("test/Inventory") {}
    const definition = Step.make({
      name: "inventory.service",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const runtime = ManagedRuntime.make(
      Layer.merge(AdapterSupervisor.layer, definition.toLayer(() => Inventory.use(Effect.succeed))).pipe(
        Layer.provideMerge(Layer.succeed(Inventory, "reservation-1"))
      )
    )
    await runtime.context()

    const result = await StepAdapter.make(definition, runtime.runPromise)(info, null)

    assert.deepStrictEqual(result, DurableOutcome.success(
      DurableOutcome.identityOf(definition),
      "reservation-1"
    ))
    await runtime.dispose()
  })

  it("resolves a single checked failure as a durable Failure envelope", async () => {
    const definition = Step.make({
      name: "payment.decline",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Struct({ reason: Schema.String })
    })
    const runtime = makeRuntime(definition, () => Effect.fail({ reason: "declined" }))
    await runtime.context()

    const result = await StepAdapter.make(definition, runtime.runPromise)(info, null)

    assert.deepStrictEqual(result, DurableOutcome.failure(
      DurableOutcome.identityOf(definition),
      { reason: "declined" }
    ))
    await runtime.dispose()
  })

  it("rejects an Effect defect as Defect", async () => {
    const definition = Step.make({
      name: "inventory.defect",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.die("boom"))
    await runtime.context()

    await expectReason(StepAdapter.make(definition, runtime.runPromise)(info, null), "Defect")
    await runtime.dispose()
  })

  it("passes a synchronous Error throw through unchanged", async () => {
    const definition = Step.make({
      name: "inventory.throw",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const defect = new TypeError("boom")
    const runtime = makeRuntime(definition, (): Effect.Effect<never> => {
        throw defect
    })
    await runtime.context()

    assert.strictEqual(
      await rejectionOf(StepAdapter.make(definition, runtime.runPromise)(info, null)),
      defect
    )
    await runtime.dispose()
  })

  it("passes an Error defect through unchanged", async () => {
    const definition = Step.make({
      name: "inventory.typed-defect",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const defect = new TypeError("original defect")
    const runtime = makeRuntime(definition, () => Effect.die(defect))
    await runtime.context()

    const rejected = await rejectionOf(StepAdapter.make(definition, runtime.runPromise)(info, null))

    assert.strictEqual(rejected, defect)
    await runtime.dispose()
  })

  it("rejects deliberate interruption as Interrupted", async () => {
    const definition = Step.make({
      name: "inventory.interrupted",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.interrupt)
    await runtime.context()

    await expectReason(StepAdapter.make(definition, runtime.runPromise)(info, null), "Interrupted")
    await runtime.dispose()
  })

  it("rejects mixed checked and defect causes as CompositeCause", async () => {
    const definition = Step.make({
      name: "inventory.composite",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.String
    })
    const runtime = makeRuntime(definition, () => Effect.failCause(
        Cause.combine(Cause.fail("expected"), Cause.die("boom"))
      ))
    await runtime.context()

    await expectReason(StepAdapter.make(definition, runtime.runPromise)(info, null), "CompositeCause")
    await runtime.dispose()
  })

  it("rejects an empty Cause as Unknown", async () => {
    const definition = Step.make({
      name: "inventory.empty-cause",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.failCause(Cause.empty))
    await runtime.context()

    await expectReason(StepAdapter.make(definition, runtime.runPromise)(info, null), "Unknown")
    await runtime.dispose()
  })

  it("rejects the wrong argument arity before executing user code", async () => {
    let executions = 0
    const definition = Step.make({
      name: "inventory.arity",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.sync(() => {
        executions += 1
        return null
      }))
    await runtime.context()

    await expectReason(StepAdapter.make(definition, runtime.runPromise)(info), "ContractViolation")
    assert.strictEqual(executions, 0)
    await runtime.dispose()
  })

  it("rejects JSON-valid input that violates the step schema before executing user code", async () => {
    let executions = 0
    const definition = Step.make({
      name: "inventory.input",
      version: 1,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.Null,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.sync(() => {
        executions += 1
        return null
      }))
    await runtime.context()

    await expectReason(
      StepAdapter.make(definition, runtime.runPromise)(info, { sku: 1 }),
      "ContractViolation"
    )
    assert.strictEqual(executions, 0)
    await runtime.dispose()
  })

  it("rejects non-durable step output as ContractViolation", async () => {
    const definition = Step.make({
      name: "inventory.output",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.succeed(new Date(0) as never))
    await runtime.context()

    await expectReason(
      StepAdapter.make(definition, runtime.runPromise)(info, null),
      "ContractViolation"
    )
    await runtime.dispose()
  })

  it("rejects non-durable checked failure output as ContractViolation", async () => {
    const definition = Step.make({
      name: "inventory.failure-output",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.String
    })
    const runtime = makeRuntime(definition, () => Effect.fail(new Date(0) as never))
    await runtime.context()

    await expectReason(
      StepAdapter.make(definition, runtime.runPromise)(info, null),
      "ContractViolation"
    )
    await runtime.dispose()
  })

  it("parks an admitted callback after abandonment", async () => {
    const definition = Step.make({
      name: "inventory.blocked",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.never)
    await runtime.context()
    const execution = StepAdapter.make(definition, runtime.runPromise)(info, null)

    await Promise.resolve()
    await runtime.runPromise(AdapterSupervisor.abandon)
    await runtime.runPromise(AdapterSupervisor.drain)
    const observation = await Promise.race([
      execution.then(() => "settled", () => "rejected"),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 5))
    ])

    assert.strictEqual(observation, "pending")
    await runtime.dispose()
  })

  it("parks a callback denied after admission closes", async () => {
    const definition = Step.make({
      name: "inventory.closed",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const runtime = makeRuntime(definition, () => Effect.succeed(null))
    await runtime.context()

    await runtime.runPromise(AdapterSupervisor.close)
    const execution = StepAdapter.make(definition, runtime.runPromise)(info, null)
    const observation = await Promise.race([
      execution.then(() => "settled", () => "rejected"),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 5))
    ])

    assert.strictEqual(observation, "pending")
    await runtime.dispose()
  })
})
