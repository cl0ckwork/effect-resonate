import { assert, describe, it } from "@effect/vitest"
import {
  DurablePromise as SdkDurablePromise,
  type Context as ResonateContext,
  type Info
} from "@resonatehq/sdk/async"
import { Result, Schema } from "effect"
import * as Step from "../../Step.js"
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
        return durable("child-1", Promise.resolve(
          DurableOutcome.success(DurableOutcome.identityOf(definition), null)
        ))
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    const pending = context.run(definition, { sku: "sku-1" }, {
      timeout: 500,
      target: "poll://any@inventory",
      tags: { tenant: "acme" },
      retry: { _tag: "Exponential", delay: 10, factor: 2, maxRetries: 3, maxDelay: 100 }
    })

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
    }
    assert.strictEqual(options.version, definition.version)
    assert.strictEqual(options.timeout, 500)
    assert.strictEqual(options.target, "poll://any@inventory")
    assert.deepStrictEqual(options.tags, { tenant: "acme" })
    assert.deepStrictEqual(options.retryPolicy.encode(), {
      type: "exponential",
      data: { delay: 10, factor: 2, maxRetries: 3, maxDelay: 100 }
    })
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
        return durable("rpc-1", Promise.resolve(
          DurableOutcome.success(DurableOutcome.identityOf(definition), "available")
        ))
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
          ? durable("failure", Promise.resolve(
            DurableOutcome.failure(DurableOutcome.identityOf(definition), { reason: "declined" })
          ))
          : durable("rejected", Promise.reject({
            _tag: "@effect-resonate/core/ExecutionRejected",
            executionId: "rejected",
            definitionName: definition.name,
            definitionVersion: definition.version,
            reason: "Defect"
          }))
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    assert.deepStrictEqual(
      await context.run(definition, null),
      Result.fail({ reason: "declined" })
    )
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

    const rejected = await rejectionOf(
      WorkflowContextImpl.make(sdkContext).run(definition, null)
    )

    assert.deepInclude(rejected, {
      _tag: "@effect-resonate/core/DurableProtocolError"
    })
  })

  it("validates outbound durable values before invoking the SDK", async () => {
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
      },
      promise: () => {
        calls += 1
        return durable("unreachable", Promise.resolve(null))
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)

    assert.deepInclude(await rejectionOf(
      context.run(definition, new Date(0) as never)
    ), {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadEncodeFailed"
    })
    assert.deepInclude(await rejectionOf(
      context.promise(Schema.Null, { data: new Date(0) as never })
    ), {
      _tag: "@effect-resonate/core/InvalidDurableValue",
      location: "PromiseData"
    })
    assert.strictEqual(calls, 0)
  })

  it("decodes external promises and rejects schema mismatches", async () => {
    let invocation = 0
    const sdkContext = {
      ...info,
      promise: () => {
        invocation += 1
        return invocation === 1
          ? durable("approval-1", Promise.resolve({ approved: true }))
          : durable("approval-2", Promise.resolve({ approved: "yes" }))
      }
    } as unknown as ResonateContext
    const context = WorkflowContextImpl.make(sdkContext)
    const schema = Schema.Struct({ approved: Schema.Boolean })

    assert.deepStrictEqual(await context.promise(schema), { approved: true })
    assert.deepInclude(await rejectionOf(context.promise(schema)), {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadDecodeFailed"
    })
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
    await context.sleep({ until: 1_000 })
    assert.deepStrictEqual(calls, [10, { for: 20 }, { until: new Date(1_000) }])
    assert.strictEqual(await context.date.now(), 123)
    assert.strictEqual(await context.math.random(), 0.5)
    assert.strictEqual(context.id, info.id)
    assert.isTrue(Object.isFrozen(context))
  })
})
