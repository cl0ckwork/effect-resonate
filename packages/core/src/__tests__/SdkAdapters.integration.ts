import { assert, describe, it } from "@effect/vitest"
import { Constant, Resonate } from "@resonatehq/sdk/async"
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect"
import * as Step from "../Step.js"
import { StepContext } from "../StepContext.js"
import * as Workflow from "../Workflow.js"
import { AdapterSupervisor } from "../internal/AdapterSupervisor.js"
import * as DurableOutcome from "../internal/DurableOutcome.js"
import * as StepAdapter from "../internal/StepAdapter.js"
import * as WorkflowAdapter from "../internal/WorkflowAdapter.js"

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
    assert.fail("expected promise rejection")
  } catch (cause) {
    return cause
  }
}

describe("SDK adapter contracts", () => {
  it("runs Effect steps through the async engine and preserves stable metadata", async () => {
    const resonate = new Resonate()
    const observedIds: Array<string> = []
    const observedAttempts: Array<number> = []

    const Reserve = Step.make({
      name: "inventory.reserve",
      version: 2,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.Struct({ reservationId: Schema.String, stepId: Schema.String }),
      failure: Schema.Struct({ reason: Schema.String })
    })
    const ReserveLive = Reserve.toLayer((input) => Effect.gen(function*() {
        const context = yield* StepContext
        observedIds.push(context.id)
        observedAttempts.push(context.attempt)
        return { reservationId: `reservation-${input.sku}`, stepId: context.id }
      }))
    const Checkout = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.Struct({
        reservationId: Schema.String,
        stepId: Schema.String,
        timestamp: Schema.Number,
        random: Schema.Number
      }),
      failure: Schema.Struct({ reason: Schema.String })
    })
    const CheckoutLive = Checkout.toLayer(async (context, input) => {
        const reservation = await context.run(Reserve, input)
        if (Result.isFailure(reservation)) {
          return Result.fail(reservation.failure)
        }
        await context.sleep(0)
        const timestamp = await context.date.now()
        const random = await context.math.random()
        return Result.succeed({ ...reservation.success, timestamp, random })
      })
    const runtime = ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, ReserveLive))
    await runtime.context()
    const checkoutHandler = await Effect.runPromise(Checkout.handler.pipe(Effect.provide(CheckoutLive)))

    resonate.register(Reserve.name, StepAdapter.make(Reserve, runtime.runPromise), {
      version: Reserve.version
    })
    const checkout = resonate.register(
      Checkout.name,
      WorkflowAdapter.make(Checkout, checkoutHandler),
      { version: Checkout.version }
    )

    try {
      const handle = await checkout.run("checkout-success", { sku: "sku-1" })
      const encoded = await handle.result()
      const decoded = DurableOutcome.decodeWorkflowResult(Checkout, handle.id, encoded)

      assert.isTrue(Result.isSuccess(decoded))
      if (Result.isSuccess(decoded)) {
        assert.isTrue(Result.isSuccess(decoded.success))
        if (Result.isSuccess(decoded.success)) {
          assert.strictEqual(decoded.success.success.reservationId, "reservation-sku-1")
          assert.strictEqual(decoded.success.success.stepId, observedIds[0])
          assert.isNumber(decoded.success.success.timestamp)
          assert.isAtLeast(decoded.success.success.random, 0)
          assert.isBelow(decoded.success.success.random, 1)
        }
      }
      assert.lengthOf(observedIds, 1)
      assert.deepStrictEqual(observedAttempts, [1])
    } finally {
      await runtime.runPromise(AdapterSupervisor.close)
      await runtime.runPromise(AdapterSupervisor.drain)
      await resonate.stop()
      await runtime.dispose()
    }
  })

  it("keeps checked failures resolved so Resonate does not retry them", async () => {
    const resonate = new Resonate()
    let attempts = 0

    const Decline = Step.make({
      name: "payment.decline",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Struct({ reason: Schema.String })
    })
    const DeclineLive = Decline.toLayer(() => Effect.suspend(() => {
        attempts += 1
        return Effect.fail({ reason: "declined" })
      }))
    const Checkout = Workflow.make({
      name: "checkout.decline",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Struct({ reason: Schema.String })
    })
    const CheckoutLive = Checkout.toLayer(async (context) => context.run(Decline, null, {
      retryPolicy: new Constant({ delay: 0, maxRetries: 3 })
      }))
    const runtime = ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, DeclineLive))
    await runtime.context()
    const checkoutHandler = await Effect.runPromise(Checkout.handler.pipe(Effect.provide(CheckoutLive)))

    resonate.register(Decline.name, StepAdapter.make(Decline, runtime.runPromise), {
      version: Decline.version
    })
    const checkout = resonate.register(
      Checkout.name,
      WorkflowAdapter.make(Checkout, checkoutHandler),
      { version: Checkout.version }
    )

    try {
      const handle = await checkout.run("checkout-declined", null)
      const decoded = DurableOutcome.decodeWorkflowResult(Checkout, handle.id, await handle.result())

      assert.deepStrictEqual(decoded, Result.succeed(Result.fail({ reason: "declined" })))
      assert.strictEqual(attempts, 1)
    } finally {
      await runtime.runPromise(AdapterSupervisor.close)
      await runtime.runPromise(AdapterSupervisor.drain)
      await resonate.stop()
      await runtime.dispose()
    }
  })

  it("uses explicit Resonate retry for rejected attempts and keeps the durable step id", async () => {
    const resonate = new Resonate()
    const observedIds: Array<string> = []
    const observedAttempts: Array<number> = []

    const Flaky = Step.make({
      name: "inventory.flaky",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.String
    })
    const FlakyLive = Flaky.toLayer(() => Effect.gen(function*() {
        const context = yield* StepContext
        observedIds.push(context.id)
        observedAttempts.push(context.attempt)
        if (context.attempt === 1) {
          return yield* Effect.die("first attempt fails")
        }
        return "recovered"
      }))
    const Recover = Workflow.make({
      name: "inventory.recover",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.String
    })
    const RecoverLive = Recover.toLayer(async (context) => context.run(Flaky, null, {
      retryPolicy: new Constant({ delay: 0, maxRetries: 1 })
      }))
    const runtime = ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, FlakyLive))
    await runtime.context()
    const recoverHandler = await Effect.runPromise(Recover.handler.pipe(Effect.provide(RecoverLive)))

    resonate.register(Flaky.name, StepAdapter.make(Flaky, runtime.runPromise), {
      version: Flaky.version
    })
    const recover = resonate.register(
      Recover.name,
      WorkflowAdapter.make(Recover, recoverHandler),
      { version: Recover.version }
    )

    try {
      const handle = await recover.run("inventory-recover", null)
      const decoded = DurableOutcome.decodeWorkflowResult(Recover, handle.id, await handle.result())

      assert.deepStrictEqual(decoded, Result.succeed(Result.succeed("recovered")))
      assert.deepStrictEqual(observedAttempts, [1, 2])
      assert.lengthOf(new Set(observedIds), 1)
    } finally {
      await runtime.runPromise(AdapterSupervisor.close)
      await runtime.runPromise(AdapterSupervisor.drain)
      await resonate.stop()
      await runtime.dispose()
    }
  })

  it("lets Resonate classify an original Effect defect with nonRetryableErrors", async () => {
    const resonate = new Resonate()
    let attempts = 0
    const Broken = Step.make({
      name: "inventory.non-retryable",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const BrokenLive = Broken.toLayer(() => Effect.suspend(() => {
        attempts += 1
        return Effect.die(new TypeError("do not retry"))
      }))
    const Checkout = Workflow.make({
      name: "checkout.non-retryable",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const CheckoutLive = Checkout.toLayer(async (context) => context.run(Broken, null, {
      retryPolicy: new Constant({ delay: 0, maxRetries: 3 }),
      nonRetryableErrors: [TypeError]
    }))
    const runtime = ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, BrokenLive))
    await runtime.context()
    const checkoutHandler = await Effect.runPromise(Checkout.handler.pipe(Effect.provide(CheckoutLive)))

    resonate.register(Broken.name, StepAdapter.make(Broken, runtime.runPromise), {
      version: Broken.version
    })
    const checkout = resonate.register(
      Checkout.name,
      WorkflowAdapter.make(Checkout, checkoutHandler),
      { version: Checkout.version }
    )

    try {
      const handle = await checkout.run("checkout-non-retryable", null)
      const rejected = await rejectionOf(handle.result())

      assert.deepInclude(rejected, {
        _tag: "@effect-resonate/core/ExecutionRejected",
        executionId: "checkout-non-retryable",
        definitionName: Checkout.name,
        reason: "Defect"
      })
      assert.strictEqual(attempts, 1)
    } finally {
      await runtime.runPromise(AdapterSupervisor.close)
      await runtime.runPromise(AdapterSupervisor.drain)
      await resonate.stop()
      await runtime.dispose()
    }
  })

  it("normalizes an uncaught child Error at the typed workflow boundary", async () => {
    const resonate = new Resonate()
    let attempts = 0

    const Broken = Step.make({
      name: "inventory.broken",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const BrokenLive = Broken.toLayer(() => Effect.suspend(() => {
        attempts += 1
        return Effect.die(new TypeError("boom"))
      }))
    const Checkout = Workflow.make({
      name: "checkout.broken",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Null
    })
    const CheckoutLive = Checkout.toLayer(async (context) => {
        await context.run(Broken, null)
        return Result.succeed(null)
      })
    const runtime = ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, BrokenLive))
    await runtime.context()
    const checkoutHandler = await Effect.runPromise(Checkout.handler.pipe(Effect.provide(CheckoutLive)))

    resonate.register(Broken.name, StepAdapter.make(Broken, runtime.runPromise), {
      version: Broken.version
    })
    const checkout = resonate.register(
      Checkout.name,
      WorkflowAdapter.make(Checkout, checkoutHandler),
      { version: Checkout.version }
    )

    try {
      const handle = await checkout.run("checkout-broken", null)
      const rejected = await rejectionOf(handle.result())

      assert.deepStrictEqual(rejected, {
        _tag: "@effect-resonate/core/ExecutionRejected",
        executionId: "checkout-broken",
        definitionName: "checkout.broken",
        definitionVersion: 1,
        reason: "Defect"
      })
      assert.strictEqual(attempts, 1)
    } finally {
      await runtime.runPromise(AdapterSupervisor.close)
      await runtime.runPromise(AdapterSupervisor.drain)
      await resonate.stop()
      await runtime.dispose()
    }
  })

  it("decodes an externally resolved durable promise with the workflow codec", async () => {
    const runtime = ManagedRuntime.make(Layer.empty)
    await runtime.context()
    const resonate = new Resonate()
    const Approval = Workflow.make({
      name: "checkout.approval",
      version: 1,
      input: Schema.Null,
      success: Schema.Boolean,
      failure: Schema.Null
    })
    const ApprovalLive = Approval.toLayer(async (context) => {
        const approval = await context.promise(Schema.Struct({ approved: Schema.Boolean }))
        return Result.succeed(approval.approved)
      })
    const approvalHandler = await Effect.runPromise(Approval.handler.pipe(Effect.provide(ApprovalLive)))
    const approval = resonate.register(
      Approval.name,
      WorkflowAdapter.make(Approval, approvalHandler),
      { version: Approval.version }
    )

    try {
      const handle = await approval.run("checkout-approval", null)
      const result = handle.result()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await resonate.promises.resolve("checkout-approval:0", {
        data: Buffer.from(JSON.stringify({ approved: true })).toString("base64")
      })
      const decoded = DurableOutcome.decodeWorkflowResult(Approval, handle.id, await result)

      assert.deepStrictEqual(decoded, Result.succeed(Result.succeed(true)))
    } finally {
      await resonate.stop()
      await runtime.dispose()
    }
  })

  it("observes timeout state structurally without parsing SDK error messages", async () => {
    const resonate = new Resonate()
    const Blocked = Step.make({
      name: "inventory.blocked-timeout",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const BlockedLive = Blocked.toLayer(() => Effect.never)
    const Checkout = Workflow.make({
      name: "checkout.timeout",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Null
    })
    const CheckoutLive = Checkout.toLayer(async (context) => {
        await context.run(Blocked, null)
        return Result.succeed(null)
      })
    const runtime = ManagedRuntime.make(Layer.merge(AdapterSupervisor.layer, BlockedLive))
    await runtime.context()
    const checkoutHandler = await Effect.runPromise(Checkout.handler.pipe(Effect.provide(CheckoutLive)))

    resonate.register(Blocked.name, StepAdapter.make(Blocked, runtime.runPromise), {
      version: Blocked.version
    })
    const checkout = resonate.register(
      Checkout.name,
      WorkflowAdapter.make(Checkout, checkoutHandler),
      { version: Checkout.version }
    )

    try {
      const handle = await checkout.run(
        "checkout-timeout",
        null,
        resonate.options({ timeout: 20 })
      )
      await rejectionOf(handle.result())
      const record = await resonate.promises.get(handle.id)

      assert.strictEqual(record.state, "rejected_timedout")
    } finally {
      await runtime.runPromise(AdapterSupervisor.abandon)
      await resonate.stop()
      await runtime.runPromise(AdapterSupervisor.drain)
      await runtime.dispose()
    }
  })
})
