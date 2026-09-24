import { assert, describe, it } from "@effect/vitest"
import {
  DurablePromise as SdkDurablePromise,
  type Context as ResonateContext,
  type Info
} from "@resonatehq/sdk/async"
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect"
import * as Step from "../Step.js"
import * as Workflow from "../Workflow.js"
import { AdapterSupervisor } from "../internal/AdapterSupervisor.js"
import * as DurableOutcome from "../internal/DurableOutcome.js"
import * as StepAdapter from "../internal/StepAdapter.js"
import * as WorkflowAdapter from "../internal/WorkflowAdapter.js"

const stepInfo = (definition: Step.Any, id: string): Info => ({
  id,
  parentId: "order-42",
  originId: "order-42",
  branchId: "order-42",
  timeoutAt: 10_000,
  attempt: 1,
  version: definition.version,
  func: definition.name,
  getDependency: () => undefined
})

const workflowInfo = (definition: Workflow.Any): Info => ({
  id: `checkout-${definition.version}`,
  parentId: `checkout-${definition.version}`,
  originId: `checkout-${definition.version}`,
  branchId: `checkout-${definition.version}`,
  timeoutAt: 10_000,
  attempt: 1,
  version: definition.version,
  func: definition.name,
  getDependency: () => undefined
})

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

describe("contract evolution runtime", () => {
  it("runs old and evolved step implementations side-by-side", async () => {
    const ChargeCardV1 = Step.make({
      name: "payments.charge",
      version: 1,
      input: Schema.Struct({ amount: Schema.Number }),
      success: Schema.Struct({ receipt: Schema.String }),
      failure: Schema.Never
    })
    const ChargeCardV2 = Step.evolve(ChargeCardV1, {
      version: 2,
      input: Schema.Struct({ amount: Schema.Number, currency: Schema.String }),
      success: Schema.Struct({ receipt: Schema.String, captured: Schema.Boolean }),
      failure: Schema.Never
    })
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AdapterSupervisor.layer,
        ChargeCardV1.toLayer(({ amount }) => Effect.succeed({ receipt: `legacy-${amount}` })),
        ChargeCardV2.toLayer(({ amount, currency }) =>
          Effect.succeed({
            receipt: `${currency}-${amount}`,
            captured: true
          })
        )
      )
    )
    await runtime.context()

    const legacy = await StepAdapter.make(ChargeCardV1, runtime.runPromise)(
      stepInfo(ChargeCardV1, "charge-1"),
      { amount: 10 }
    )
    const current = await StepAdapter.make(ChargeCardV2, runtime.runPromise)(
      stepInfo(ChargeCardV2, "charge-2"),
      { amount: 20, currency: "USD" }
    )

    assert.deepStrictEqual(
      legacy,
      DurableOutcome.success(DurableOutcome.identityOf(ChargeCardV1), { receipt: "legacy-10" })
    )
    assert.deepStrictEqual(
      current,
      DurableOutcome.success(DurableOutcome.identityOf(ChargeCardV2), {
        receipt: "USD-20",
        captured: true
      })
    )
    await runtime.dispose()
  })

  it("keeps each version's schema boundary isolated", async () => {
    let evolvedExecutions = 0
    const ReserveV1 = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.String,
      success: Schema.String,
      failure: Schema.Never
    })
    const ReserveV2 = Step.evolve(ReserveV1, {
      version: 2,
      input: Schema.Struct({ sku: Schema.String, quantity: Schema.Number }),
      success: Schema.String,
      failure: Schema.Never
    })
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AdapterSupervisor.layer,
        ReserveV1.toLayer((sku) => Effect.succeed(`v1:${sku}`)),
        ReserveV2.toLayer(({ sku, quantity }) =>
          Effect.sync(() => {
            evolvedExecutions += 1
            return `v2:${sku}:${quantity}`
          })
        )
      )
    )
    await runtime.context()

    const legacy = await StepAdapter.make(ReserveV1, runtime.runPromise)(
      stepInfo(ReserveV1, "reserve-1"),
      "sku-1"
    )
    assert.deepStrictEqual(
      legacy,
      DurableOutcome.success(DurableOutcome.identityOf(ReserveV1), "v1:sku-1")
    )
    assert.deepInclude(
      await rejectionOf(
        StepAdapter.make(ReserveV2, runtime.runPromise)(stepInfo(ReserveV2, "reserve-2"), "sku-1")
      ),
      {
        _tag: "@effect-resonate/core/ExecutionRejected",
        definitionName: ReserveV2.name,
        definitionVersion: ReserveV2.version,
        reason: "ContractViolation"
      }
    )
    assert.strictEqual(evolvedExecutions, 0)
    await runtime.dispose()
  })

  it("routes evolved workflow composition to the exact step version", async () => {
    const ChargeCardV1 = Step.make({
      name: "payments.charge",
      version: 1,
      input: Schema.Struct({ amount: Schema.Number }),
      success: Schema.Struct({ receipt: Schema.String }),
      failure: Schema.Never
    })
    const ChargeCardV2 = Step.evolve(ChargeCardV1, {
      version: 2,
      input: ChargeCardV1.input,
      success: ChargeCardV1.success,
      failure: ChargeCardV1.failure
    })
    const CheckoutV1 = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Struct({ amount: Schema.Number }),
      success: Schema.Struct({ receipt: Schema.String }),
      failure: Schema.Never
    })
    const CheckoutV2 = Workflow.evolve(CheckoutV1, {
      version: 2,
      input: CheckoutV1.input,
      success: CheckoutV1.success,
      failure: CheckoutV1.failure
    })
    const runtime = ManagedRuntime.make(
      Layer.merge(
        CheckoutV1.toLayer(async (context, input) => context.run(ChargeCardV1, input)),
        CheckoutV2.toLayer(async (context, input) => context.run(ChargeCardV2, input))
      )
    )

    const calls: Array<{ readonly name: string; readonly version: number }> = []
    const sdkContext = <Definition extends Step.Any>(
      workflow: Workflow.Any,
      step: Definition,
      receipt: string
    ): ResonateContext =>
      ({
        ...workflowInfo(workflow),
        options: (options: unknown) => options,
        run: (name: string, _input: unknown, options: { readonly version: number }) => {
          calls.push({ name, version: options.version })
          return durable(
            `${workflow.name}-${workflow.version}:1`,
            Promise.resolve(DurableOutcome.success(DurableOutcome.identityOf(step), { receipt }))
          )
        }
      }) as unknown as ResonateContext
    const workflowHandlerV1 = await runtime.runPromise(CheckoutV1.handler)
    const workflowHandlerV2 = await runtime.runPromise(CheckoutV2.handler)

    const legacy = await WorkflowAdapter.make(CheckoutV1, workflowHandlerV1)(
      sdkContext(CheckoutV1, ChargeCardV1, "receipt-v1"),
      { amount: 10 }
    )
    const current = await WorkflowAdapter.make(CheckoutV2, workflowHandlerV2)(
      sdkContext(CheckoutV2, ChargeCardV2, "receipt-v2"),
      { amount: 20 }
    )

    assert.deepStrictEqual(calls, [
      { name: ChargeCardV1.name, version: 1 },
      { name: ChargeCardV2.name, version: 2 }
    ])
    assert.deepStrictEqual(
      legacy,
      DurableOutcome.success(DurableOutcome.identityOf(CheckoutV1), { receipt: "receipt-v1" })
    )
    assert.deepStrictEqual(
      current,
      DurableOutcome.success(DurableOutcome.identityOf(CheckoutV2), { receipt: "receipt-v2" })
    )
    await runtime.dispose()
  })

  it("resumes from a legacy step checkpoint and adapts its output for a V2 step", async () => {
    const Failure = Schema.Struct({ reason: Schema.String })
    const CalculateTotalV1 = Step.make({
      name: "checkout.calculate-total",
      version: 1,
      input: Schema.Struct({ orderId: Schema.String }),
      success: Schema.Struct({ totalCents: Schema.Number }),
      failure: Failure
    })
    const ChargeV1 = Step.make({
      name: "payments.charge",
      version: 1,
      input: Schema.Struct({ totalCents: Schema.Number }),
      success: Schema.Struct({ paymentId: Schema.String }),
      failure: Failure
    })
    const ChargeV2 = Step.evolve(ChargeV1, {
      version: 2,
      input: Schema.Struct({
        amount: Schema.Struct({ currency: Schema.String, minorUnits: Schema.Number }),
        migratedFromStepVersion: Schema.Number
      }),
      success: ChargeV1.success,
      failure: ChargeV1.failure
    })
    const CheckoutV1 = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Struct({ orderId: Schema.String }),
      success: Schema.Struct({ paymentId: Schema.String }),
      failure: Failure
    })
    const CheckoutV2 = Workflow.evolve(CheckoutV1, {
      version: 2,
      input: CheckoutV1.input,
      success: CheckoutV1.success,
      failure: CheckoutV1.failure
    })
    const CheckoutV2Live = CheckoutV2.toLayer(async (context, input) => {
      const legacyTotal = await context.run(CalculateTotalV1, input)
      if (Result.isFailure(legacyTotal)) {
        return Result.fail(legacyTotal.failure)
      }
      return context.run(ChargeV2, {
        amount: {
          currency: "USD",
          minorUnits: legacyTotal.success.totalCents
        },
        migratedFromStepVersion: CalculateTotalV1.version
      })
    })
    const runtime = ManagedRuntime.make(CheckoutV2Live)
    const handler = await runtime.runPromise(CheckoutV2.handler)
    const calls: Array<{
      readonly name: string
      readonly input: unknown
      readonly version: number
    }> = []
    const replayContext = {
      ...workflowInfo(CheckoutV2),
      options: (options: unknown) => options,
      run: (name: string, input: unknown, options: { readonly version: number }) => {
        const isLegacyCheckpoint = calls.length === 0
        calls.push({ name, input, version: options.version })
        return isLegacyCheckpoint
          ? durable(
              "checkout-2:1",
              Promise.resolve(
                DurableOutcome.success(DurableOutcome.identityOf(CalculateTotalV1), {
                  totalCents: 1_250
                })
              )
            )
          : durable(
              "checkout-2:2",
              Promise.resolve(
                DurableOutcome.success(DurableOutcome.identityOf(ChargeV2), {
                  paymentId: "payment-2"
                })
              )
            )
      }
    } as unknown as ResonateContext

    const result = await WorkflowAdapter.make(CheckoutV2, handler)(replayContext, {
      orderId: "order-42"
    })

    assert.deepStrictEqual(calls, [
      {
        name: CalculateTotalV1.name,
        input: { orderId: "order-42" },
        version: 1
      },
      {
        name: ChargeV2.name,
        input: {
          amount: { currency: "USD", minorUnits: 1_250 },
          migratedFromStepVersion: 1
        },
        version: 2
      }
    ])
    assert.deepStrictEqual(
      result,
      DurableOutcome.success(DurableOutcome.identityOf(CheckoutV2), { paymentId: "payment-2" })
    )
    await runtime.dispose()
  })
})
