import { assert, describe, it } from "@effect/vitest"
import {
  DurablePromise as SdkDurablePromise,
  type Context as ResonateContext,
  type Info
} from "@resonatehq/sdk/async"
import { Result, Schema } from "effect"
import * as Step from "../../Step.js"
import * as Workflow from "../../Workflow.js"
import * as DurableOutcome from "../DurableOutcome.js"
import * as WorkflowAdapter from "../WorkflowAdapter.js"

const info: Info = {
  id: "checkout-1",
  parentId: "checkout-1",
  originId: "checkout-1",
  branchId: "checkout-1",
  timeoutAt: 10_000,
  attempt: 1,
  version: 1,
  func: "checkout",
  getDependency: () => undefined
}

const context = info as unknown as ResonateContext

const durable = <Value>(id: string, promise: Promise<Value>): SdkDurablePromise<Value> =>
  new SdkDurablePromise(id, promise)

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
    assert.fail("expected promise rejection")
  } catch (cause) {
    return cause
  }
}

describe("WorkflowAdapter", () => {
  it("returns InvalidInput for the wrong argument arity without running user code", async () => {
    let executions = 0
    const definition = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Null
    })
    const handler = {
      execute: async () => {
        executions += 1
        return Result.succeed(null)
      }
    }

    const result = await WorkflowAdapter.make(definition, handler)(context)

    assert.deepStrictEqual(
      result,
      DurableOutcome.invalidInput(DurableOutcome.identityOf(definition))
    )
    assert.strictEqual(executions, 0)
  })

  it("returns InvalidInput for schema-invalid input without running user code", async () => {
    let executions = 0
    const definition = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Struct({ orderId: Schema.String }),
      success: Schema.Null,
      failure: Schema.Null
    })
    const handler = {
      execute: async () => {
        executions += 1
        return Result.succeed(null)
      }
    }

    const result = await WorkflowAdapter.make(definition, handler)(context, { orderId: 1 })

    assert.deepStrictEqual(
      result,
      DurableOutcome.invalidInput(DurableOutcome.identityOf(definition))
    )
    assert.strictEqual(executions, 0)
  })

  it("encodes the workflow success branch", async () => {
    const definition = Workflow.make({
      name: "checkout.success",
      version: 1,
      input: Schema.Null,
      success: Schema.Struct({ accepted: Schema.Boolean }),
      failure: Schema.Null
    })
    const handler = { execute: async () => Result.succeed({ accepted: true }) }

    const result = await WorkflowAdapter.make(definition, handler)(context, null)

    assert.deepStrictEqual(
      result,
      DurableOutcome.success(DurableOutcome.identityOf(definition), { accepted: true })
    )
  })

  it("encodes the workflow checked-failure branch", async () => {
    const definition = Workflow.make({
      name: "checkout.failure",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Struct({ reason: Schema.String })
    })
    const handler = { execute: async () => Result.fail({ reason: "declined" }) }

    const result = await WorkflowAdapter.make(definition, handler)(context, null)

    assert.deepStrictEqual(
      result,
      DurableOutcome.failure(DurableOutcome.identityOf(definition), { reason: "declined" })
    )
  })

  it("rejects a non-Result workflow return as ContractViolation", async () => {
    const definition = Workflow.make({
      name: "checkout.not-result",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Null
    })
    const handler = { execute: async () => null as never }

    const rejected = await rejectionOf(WorkflowAdapter.make(definition, handler)(context, null))

    assert.deepInclude(rejected, {
      _tag: "@effect-resonate/core/ExecutionRejected",
      reason: "ContractViolation"
    })
  })

  it("rejects schema-invalid success output as ContractViolation", async () => {
    const definition = Workflow.make({
      name: "checkout.invalid-success",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Null
    })
    const handler = { execute: async () => Result.succeed(new Date(0) as never) }

    const rejected = await rejectionOf(WorkflowAdapter.make(definition, handler)(context, null))

    assert.deepInclude(rejected, {
      _tag: "@effect-resonate/core/ExecutionRejected",
      reason: "ContractViolation"
    })
  })

  it("rejects schema-invalid checked-failure output as ContractViolation", async () => {
    const definition = Workflow.make({
      name: "checkout.invalid-failure",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.String
    })
    const handler = { execute: async () => Result.fail(new Date(0) as never) }

    const rejected = await rejectionOf(WorkflowAdapter.make(definition, handler)(context, null))

    assert.deepInclude(rejected, {
      _tag: "@effect-resonate/core/ExecutionRejected",
      reason: "ContractViolation"
    })
  })

  it("turns an arbitrary workflow defect into a durable rejection record", async () => {
    const definition = Workflow.make({
      name: "checkout.defect",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Null
    })
    const handler = {
      execute: async () => {
        throw new TypeError("boom")
      }
    }

    const rejected = await rejectionOf(WorkflowAdapter.make(definition, handler)(context, null))

    assert.deepStrictEqual(rejected, {
      _tag: "@effect-resonate/core/ExecutionRejected",
      executionId: info.id,
      definitionName: definition.name,
      definitionVersion: definition.version,
      reason: "Defect"
    })
  })

  it("roots a child rejection at the workflow while preserving child provenance", async () => {
    const step = Step.make({
      name: "inventory.broken",
      version: 2,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const definition = Workflow.make({
      name: "checkout.child-rejection",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Null
    })
    const handler = {
      execute: async (workflow: import("../../WorkflowContext.js").WorkflowContext) => {
        await workflow.run(step, null)
        return Result.succeed(null)
      }
    }
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      run: () =>
        durable(
          "child-1",
          Promise.reject({
            _tag: "@effect-resonate/core/ExecutionRejected",
            executionId: "child-1",
            definitionName: step.name,
            definitionVersion: step.version,
            reason: "Defect"
          })
        )
    } as unknown as ResonateContext

    const rejected = await rejectionOf(WorkflowAdapter.make(definition, handler)(sdkContext, null))

    assert.deepStrictEqual(rejected, {
      _tag: "@effect-resonate/core/ExecutionRejected",
      executionId: info.id,
      definitionName: definition.name,
      definitionVersion: definition.version,
      reason: "Defect",
      source: {
        executionId: "child-1",
        definitionName: step.name,
        definitionVersion: step.version
      }
    })
  })
})
