import { assert, describe, it } from "@effect/vitest"
import {
  DurablePromise as SdkDurablePromise,
  Exponential,
  type Context as ResonateContext,
  type Info
} from "@resonatehq/sdk/async"
import { Result, Schema } from "effect"
import * as Step from "../../Step.js"
import * as Workflow from "../../Workflow.js"
import * as DurableOutcome from "../DurableOutcome.js"
import * as WorkflowContextImpl from "../WorkflowContextImpl.js"

const info: Info = {
  id: "order-42:1",
  parentId: "order-42",
  originId: "order-42",
  branchId: "order-42",
  timeoutAt: 10_000,
  attempt: 2,
  version: 1,
  func: "checkout",
  getDependency: () => undefined
}

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

describe("WorkflowContextImpl", () => {
  it("delegates run eagerly with the exact version and invocation options", async () => {
    const definition = Step.make({
      name: "inventory.reserve",
      version: 3,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.Null,
      failure: Schema.Never
    })
    const calls: Array<ReadonlyArray<unknown>> = []
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      run: (...arguments_: ReadonlyArray<unknown>) => {
        calls.push(arguments_)
        return durable(
          "child-1",
          Promise.resolve(DurableOutcome.success(DurableOutcome.identityOf(definition), null))
        )
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    const pending = context.run(
      definition,
      { sku: "sku-1" },
      {
        timeout: 500,
        target: "poll://any@inventory",
        tags: { tenant: "acme" },
        retryPolicy: new Exponential({ delay: 10, factor: 2, maxRetries: 3, maxDelay: 100 }),
        nonRetryableErrors: [TypeError]
      }
    )

    assert.strictEqual(pending.id, "child-1")
    assert.deepStrictEqual(await pending, Result.succeed(null))
    assert.strictEqual(calls[0]?.[0], definition.name)
    assert.deepStrictEqual(calls[0]?.[1], { sku: "sku-1" })
    const options = calls[0]?.[2] as {
      readonly version: number
      readonly timeout: number
      readonly target: string
      readonly tags: Readonly<Record<string, string>>
      readonly retryPolicy: { readonly encode: () => unknown }
      readonly nonRetryableErrors: ReadonlyArray<unknown>
    }
    assert.strictEqual(options.version, definition.version)
    assert.strictEqual(options.timeout, 500)
    assert.strictEqual(options.target, "poll://any@inventory")
    assert.deepStrictEqual(options.tags, { tenant: "acme" })
    assert.deepStrictEqual(options.retryPolicy.encode(), {
      type: "exponential",
      data: { delay: 10, factor: 2, maxRetries: 3, maxDelay: 100 }
    })
    assert.deepStrictEqual(options.nonRetryableErrors, [TypeError])
  })

  it("preserves raw eager run and rpc calls without wrapping their durable promises", async () => {
    const calls: Array<readonly [string, ReadonlyArray<unknown>]> = []
    const runPromise = durable("raw-run", Promise.resolve("run-result"))
    const rpcPromise = durable("raw-rpc", Promise.resolve("rpc-result"))
    const sdkContext = {
      ...info,
      run: (func: unknown, ...arguments_: ReadonlyArray<unknown>) => {
        calls.push([String(func), arguments_])
        return runPromise
      },
      rpc: (func: unknown, ...arguments_: ReadonlyArray<unknown>) => {
        calls.push([String(func), arguments_])
        return rpcPromise
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)
    const rawFunction = async (_context: ResonateContext, value: string) => `${value}!`

    const run = context.run(rawFunction, "hello")
    const rpc = context.rpc<string>("remote.echo", "world")

    assert.strictEqual(run, runPromise)
    assert.strictEqual(rpc, rpcPromise)
    assert.strictEqual(await run, "run-result")
    assert.strictEqual(await rpc, "rpc-result")
    assert.strictEqual(calls.length, 2)
    assert.strictEqual(calls[0]?.[0], String(rawFunction))
    assert.deepStrictEqual(calls[0]?.[1], ["hello"])
    assert.deepStrictEqual(calls[1], ["remote.echo", ["world"]])
  })

  it("delegates rpc independently from run", async () => {
    const definition = Step.make({
      name: "inventory.lookup",
      version: 2,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    let runCalls = 0
    let rpcCalls = 0
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      run: () => {
        runCalls += 1
        return durable("run", Promise.resolve(null))
      },
      rpc: (name: string, input: unknown, options: unknown) => {
        rpcCalls += 1
        assert.strictEqual(name, definition.name)
        assert.strictEqual(input, null)
        assert.deepInclude(options, { version: definition.version })
        return durable(
          "rpc-1",
          Promise.resolve(
            DurableOutcome.success(DurableOutcome.identityOf(definition), "available")
          )
        )
      }
    } as unknown as ResonateContext

    const pending = WorkflowContextImpl.make(sdkContext).rpc(definition, null)

    assert.strictEqual(pending.id, "rpc-1")
    assert.deepStrictEqual(await pending, Result.succeed("available"))
    assert.strictEqual(rpcCalls, 1)
    assert.strictEqual(runCalls, 0)
  })

  it("reconstructs checked failures and durable execution rejections", async () => {
    const definition = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Struct({ reason: Schema.String })
    })
    let invocation = 0
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      run: () => {
        invocation += 1
        return invocation === 1
          ? durable(
              "failure",
              Promise.resolve(
                DurableOutcome.failure(DurableOutcome.identityOf(definition), {
                  reason: "declined"
                })
              )
            )
          : durable(
              "rejected",
              Promise.reject({
                _tag: "@effect-resonate/core/ExecutionRejected",
                executionId: "rejected",
                definitionName: definition.name,
                definitionVersion: definition.version,
                reason: "Defect"
              })
            )
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    assert.deepStrictEqual(await context.run(definition, null), Result.fail({ reason: "declined" }))
    assert.deepInclude(await rejectionOf(context.run(definition, null)), {
      _tag: "@effect-resonate/core/ExecutionRejected",
      executionId: "rejected",
      reason: "Defect"
    })
  })

  it("rejects malformed step envelopes at the workflow boundary", async () => {
    const definition = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      run: () => durable("child-1", Promise.resolve({ malformed: true }))
    } as unknown as ResonateContext

    const rejected = await rejectionOf(WorkflowContextImpl.make(sdkContext).run(definition, null))

    assert.deepInclude(rejected, {
      _tag: "@effect-resonate/core/DurableProtocolError"
    })
  })

  it("validates typed definition input before invoking the SDK", async () => {
    const definition = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    let calls = 0
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      run: () => {
        calls += 1
        return durable("unreachable", Promise.resolve(null))
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    assert.deepInclude(await rejectionOf(context.run(definition, new Date(0) as never)), {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadEncodeFailed"
    })
    assert.strictEqual(calls, 0)
  })

  it("decodes external promises and rejects schema mismatches", async () => {
    const calls: Array<unknown> = []
    let invocation = 0
    const sdkContext = {
      ...info,
      promise: (options: unknown) => {
        calls.push(options)
        invocation += 1
        return invocation === 1
          ? durable("approval-1", Promise.resolve({ approved: true }))
          : durable("approval-2", Promise.resolve({ approved: "yes" }))
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)
    const schema = Schema.Struct({ approved: Schema.Boolean })

    assert.deepStrictEqual(
      await context.promise(schema, {
        timeout: 500,
        data: { orderId: "order-1" },
        tags: { tenant: "acme" }
      }),
      { approved: true }
    )
    assert.deepInclude(await rejectionOf(context.promise(schema, { tags: { tenant: "acme" } })), {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadDecodeFailed"
    })
    assert.deepStrictEqual(calls, [
      { timeout: 500, data: { orderId: "order-1" }, tags: { tenant: "acme" } },
      { tags: { tenant: "acme" } }
    ])
  })

  it("preserves raw promise options and returned durable promise", async () => {
    const pending = durable("approval-raw", Promise.resolve({ approved: true }))
    const calls: Array<unknown> = []
    const sdkContext = {
      ...info,
      promise: (options: unknown) => {
        calls.push(options)
        return pending
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    const result = context.promise<{ readonly approved: boolean }>({
      timeout: 500,
      data: { orderId: "order-1" },
      tags: { tenant: "acme" }
    })

    assert.strictEqual(result, pending)
    assert.deepStrictEqual(calls, [
      {
        timeout: 500,
        data: { orderId: "order-1" },
        tags: { tenant: "acme" }
      }
    ])
  })

  it("delegates detached workflows with encoded input and exact version", async () => {
    const definition = Workflow.make({
      name: "checkout.detached",
      version: 4,
      input: Schema.Struct({ orderId: Schema.String }),
      success: Schema.Null,
      failure: Schema.Never
    })
    const calls: Array<ReadonlyArray<unknown>> = []
    const sdkContext = {
      ...info,
      options: (options: unknown) => options,
      detached: (...arguments_: ReadonlyArray<unknown>) => {
        calls.push(arguments_)
        return durable("spawn", Promise.resolve({ id: "detached-1" }))
      }
    } as unknown as ResonateContext

    const pending = WorkflowContextImpl.make(sdkContext).detached(
      definition,
      { orderId: "order-1" },
      { target: "poll://any@checkout" }
    )

    assert.deepStrictEqual(await pending, { id: "detached-1" })
    assert.deepStrictEqual(calls, [
      [
        definition.name,
        { orderId: "order-1" },
        { target: "poll://any@checkout", version: definition.version }
      ]
    ])
  })

  it("forwards dependencies, options, panic, and assert exactly once", () => {
    const dependency = { name: "inventory" }
    const calls: Array<readonly [string, unknown]> = []
    const sdkContext = {
      ...info,
      getDependency: (key: string) => (key === "inventory" ? dependency : undefined),
      options: (options: unknown) => {
        calls.push(["options", options])
        return { built: options }
      },
      panic: (condition: boolean, message?: string) => {
        calls.push(["panic", { condition, message }])
      },
      assert: (condition: boolean, message?: string) => {
        calls.push(["assert", { condition, message }])
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    assert.strictEqual(context.getDependency("inventory"), dependency)
    assert.deepStrictEqual(context.options({ timeout: 100 }), { built: { timeout: 100 } })
    context.panic(true, "stop")
    context.assert(false, "required")
    assert.deepStrictEqual(calls, [
      ["options", { timeout: 100 }],
      ["panic", { condition: true, message: "stop" }],
      ["assert", { condition: false, message: "required" }]
    ])
  })

  it("preserves synchronous context guard and abort failures", () => {
    const closed = new Error("closed")
    const panic = new Error("panic")
    const sdkContext = {
      ...info,
      run: () => {
        throw closed
      },
      panic: () => {
        throw panic
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    assert.throws(() => context.run("late"), closed)
    assert.throws(() => context.panic(true), panic)
  })

  it("delegates durable sleep, time, random, and exposes immutable metadata", async () => {
    const calls: Array<unknown> = []
    const sdkContext = {
      ...info,
      sleep: (options: unknown) => {
        calls.push(options)
        return durable("sleep", Promise.resolve())
      },
      date: { now: () => durable("date", Promise.resolve(123)) },
      math: { random: () => durable("random", Promise.resolve(0.5)) }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    await context.sleep(10)
    await context.sleep({ for: 20 })
    const until = new Date(1_000)
    await context.sleep({ until })
    assert.deepStrictEqual(calls, [10, { for: 20 }, { until }])
    assert.strictEqual(await context.date.now(), 123)
    assert.strictEqual(await context.math.random(), 0.5)
    assert.strictEqual(context.id, info.id)
    assert.strictEqual(context.func, info.func)
    assert.isTrue(Object.isFrozen(context))
  })
})
