import { assert, describe, it } from "@effect/vitest"
import { LocalNetwork } from "@resonatehq/sdk"
import type { Context as SdkContext } from "@resonatehq/sdk/async"
import { Duration, Effect, Fiber, Layer, ManagedRuntime, Result, Schedule, Schema } from "effect"
import { ResonateSdkError } from "../CoreExecutionError.js"
import * as ResonateClient from "../ResonateClient.js"
import * as ResonateFunctions from "../ResonateFunctions.js"
import * as ResonateNetwork from "../ResonateNetwork.js"
import * as Step from "../Step.js"
import * as Workflow from "../Workflow.js"

const localNetworkLayer = (
  factory: () => LocalNetwork
): Layer.Layer<ResonateNetwork.ResonateNetwork> => ResonateNetwork.make({
  factory: Effect.sync(factory)
})

const runWith = <A, E>(
  effect: Effect.Effect<A, E, ResonateClient.ResonateClient>,
  layer: Layer.Layer<ResonateClient.ResonateClient, ResonateClient.AcquisitionError>
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe("ResonateClient", () => {
  it("runs registered workflows and Effect steps through a scoped client Layer", async () => {
    const Uppercase = Step.make({
      name: "text.uppercase",
      version: 1,
      input: Schema.String,
      success: Schema.String,
      failure: Schema.Never
    })
    const Echo = Workflow.make({
      name: "text.echo",
      version: 1,
      input: Schema.String,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Uppercase, Echo)

    const dependencies = Layer.mergeAll(
      localNetworkLayer(() => new LocalNetwork()),
      Uppercase.toLayer((input) => Effect.succeed(input.toUpperCase())),
      Echo.toLayer(async (context, input) => context.run(Uppercase, input))
    )
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(dependencies))

    const output = await runWith(Effect.gen(function*() {
      const handle = yield* ResonateClient.run("echo-1", Echo, "hello")
      return yield* handle.result()
    }), ClientLive)

    assert.strictEqual(output, "HELLO")
  })

  it("mirrors raw register, run, rpc, get, options, and dependency operations with Effect handles", async () => {
    const ClientLive = ResonateClient.layer({
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(localNetworkLayer(() => new LocalNetwork())))
    const Uppercase = async (context: SdkContext, input: string): Promise<string> =>
      `${context.getDependency("prefix") as string}${input.toUpperCase()}`
    const AnonymousUppercase = async (context: SdkContext, input: string): Promise<string> =>
      `${context.getDependency("prefix") as string}${input.toUpperCase()}`

    const output = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      yield* client.setDependency("prefix", "raw:")
      const registered = yield* client.register("raw.uppercase", Uppercase, { version: 1 })
      const anonymous = yield* client.register(AnonymousUppercase, { version: 1 })
      const options = yield* registered.options({ version: 1 })
      const helperHandle = yield* registered.run("raw-helper-1", "helper")
      const helperRpcHandle = yield* registered.rpc("raw-helper-rpc-1", "helper-rpc")
      const anonymousHandle = yield* anonymous.run("raw-anonymous-1", "anonymous")
      const rawHandle = yield* client.run("raw-run-1", "raw.uppercase", "client", options)
      const rpcHandle = yield* client.rpc("raw-rpc-1", "raw.uppercase", "remote", options)
      const schedule = yield* client.schedule("raw-hourly", "0 * * * *", "raw.uppercase", "scheduled", options)
      yield* schedule.delete()
      const attached = yield* client.get<string>(rawHandle.id)

      return {
        helper: yield* helperHandle.result(),
        helperRpc: yield* helperRpcHandle.result(),
        anonymous: yield* anonymousHandle.result(),
        raw: yield* attached.result(),
        done: yield* rawHandle.done(),
        rpcId: rpcHandle.id,
        rpc: yield* rpcHandle.result(),
        rpcDone: yield* rpcHandle.done()
      }
    }), ClientLive)

    assert.deepStrictEqual(output, {
      helper: "raw:HELPER",
      helperRpc: "raw:HELPER-RPC",
      anonymous: "raw:ANONYMOUS",
      raw: "raw:CLIENT",
      done: true,
      rpcId: "raw-rpc-1",
      rpc: "raw:REMOTE",
      rpcDone: true
    })
  })

  it("surfaces checked workflow failures in the Effect error channel", async () => {
    const Decline = Workflow.make({
      name: "checkout.decline.client",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Struct({ reason: Schema.String })
    })
    const Functions = ResonateFunctions.make(Decline)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Decline.toLayer(async () => Result.fail({ reason: "declined" }))
    )))

    const failure = await runWith(Effect.gen(function*() {
      const handle = yield* ResonateClient.run("decline-1", Decline, null)
      return yield* Effect.flip(handle.result())
    }), ClientLive)

    assert.deepStrictEqual(failure, { reason: "declined" })
  })

  it("preserves Resonate first-writer-wins semantics for a reused execution id", async () => {
    const Echo = Workflow.make({
      name: "client.first-writer",
      version: 1,
      input: Schema.String,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Echo)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Echo.toLayer(async (_context, input) => Result.succeed(input))
    )))

    const outputs = await runWith(Effect.gen(function*() {
      const first = yield* ResonateClient.run("first-writer-1", Echo, "first")
      const second = yield* ResonateClient.run("first-writer-1", Echo, "second")
      return [yield* first.result(), yield* second.result()] as const
    }), ClientLive)

    assert.deepStrictEqual(outputs, ["first", "first"])
  })

  it("detects an exact workflow version mismatch when attaching", async () => {
    const V1 = Workflow.make({
      name: "client.versioned",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const V2 = Workflow.evolve(V1, {
      version: 2,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(V1, V2)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.mergeAll(
      localNetworkLayer(() => new LocalNetwork()),
      V1.toLayer(async () => Result.succeed("v1")),
      V2.toLayer(async () => Result.succeed("v2"))
    )))

    const failure = await runWith(Effect.gen(function*() {
      const started = yield* ResonateClient.run("versioned-1", V1, null)
      yield* started.result()
      const attached = yield* ResonateClient.get("versioned-1", V2)
      return yield* Effect.flip(attached.result())
    }), ClientLive)

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/DefinitionConflict",
      executionId: "versioned-1",
      expectedName: V2.name,
      expectedVersion: V2.version,
      actualName: V1.name,
      actualVersion: V1.version
    })
  })

  it("validates rejected execution identity before exposing the rejection", async () => {
    const V1 = Workflow.make({
      name: "client.rejected-versioned",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const V2 = Workflow.evolve(V1, {
      version: 2,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(V1, V2)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.mergeAll(
      localNetworkLayer(() => new LocalNetwork()),
      V1.toLayer(async () => {
        throw new TypeError("boom")
      }),
      V2.toLayer(async () => {
        throw new TypeError("boom")
      })
    )))

    const [rejected, conflict] = await runWith(Effect.gen(function*() {
      const started = yield* ResonateClient.run("rejected-versioned-1", V1, null)
      const rejected = yield* Effect.flip(started.result())
      const attached = yield* ResonateClient.get("rejected-versioned-1", V2)
      const conflict = yield* Effect.flip(attached.result())
      return [rejected, conflict] as const
    }), ClientLive)

    assert.deepInclude(rejected, {
      _tag: "@effect-resonate/core/ExecutionRejected",
      executionId: "rejected-versioned-1",
      definitionName: V1.name,
      definitionVersion: V1.version,
      reason: "Defect"
    })
    assert.deepInclude(conflict, {
      _tag: "@effect-resonate/core/DefinitionConflict",
      executionId: "rejected-versioned-1",
      expectedName: V2.name,
      expectedVersion: V2.version,
      actualName: V1.name,
      actualVersion: V1.version
    })
  })

  it("surfaces an absent attachment as a non-committing SDK lookup error", async () => {
    const Missing = Workflow.make({
      name: "client.missing",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Missing)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Missing.toLayer(async () => Result.succeed(null))
    )))

    const failure = await runWith(
      Effect.flip(ResonateClient.get("not-found", Missing)),
      ClientLive
    )

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/ResonateSdkError",
      operation: "get",
      requestMayHaveCommitted: false
    })
  })

  it("resolves an external durable promise through the client service", async () => {
    const ApprovalValue = Schema.Struct({ approved: Schema.Boolean })
    const Approval = Workflow.make({
      name: "checkout.approval.client",
      version: 1,
      input: Schema.Null,
      success: Schema.Boolean,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Approval)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Approval.toLayer(async (context) => {
        const approval = await context.promise(ApprovalValue)
        return Result.succeed(approval.approved)
      })
    )))

    const [output, invalidCancellation, missingValue] = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run("approval-1", Approval, null)
      const running = yield* handle.result().pipe(Effect.forkChild)
      yield* client.promises.resolve("approval-1:0", ApprovalValue, { approved: true }).pipe(Effect.retry({
        schedule: Schedule.spaced(Duration.millis(1)),
        times: 50
      }))
      const result = yield* Fiber.join(running)
      const invalid = yield* Effect.flip(client.promises.cancel(
        "approval-1:0",
        Schema.Struct({ nonDurable: Schema.Undefined }),
        { nonDurable: undefined }
      ))
      const malformedResolve = client.promises.resolve as (...args: ReadonlyArray<unknown>) =>
        Effect.Effect<unknown, unknown>
      const missing = yield* Effect.flip(malformedResolve("approval-1:0", Schema.String))
      return [result, invalid, missing] as const
    }), ClientLive)

    assert.isTrue(output)
    assert.deepInclude(invalidCancellation, {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadEncodeFailed"
    })
    assert.deepInclude(missingValue, {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadEncodeFailed"
    })
  })

  it("rejects and cancels external durable promises through the client service", async () => {
    const Settlement = Workflow.make({
      name: "client.external-settlement",
      version: 1,
      input: Schema.Literals(["reject", "cancel"]),
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Settlement)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Settlement.toLayer(async (context, mode) => {
        try {
          await context.promise(Schema.String)
          return Result.succeed("unexpected-resolution")
        } catch {
          return Result.succeed(mode)
        }
      })
    )))
    const settlementRetry = {
      schedule: Schedule.spaced(Duration.millis(1)),
      times: 50
    }

    const outputs = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const rejectedHandle = yield* client.run("settle-reject", Settlement, "reject")
      const rejected = yield* rejectedHandle.result().pipe(Effect.forkChild)
      yield* client.promises.reject(
        "settle-reject:0",
        Schema.Struct({ reason: Schema.String }),
        { reason: "declined" }
      ).pipe(Effect.retry(settlementRetry))

      const canceledHandle = yield* client.run("settle-cancel", Settlement, "cancel")
      const canceled = yield* canceledHandle.result().pipe(Effect.forkChild)
      yield* client.promises.cancel(
        "settle-cancel:0",
        Schema.Struct({ reason: Schema.String }),
        { reason: "withdrawn" }
      ).pipe(Effect.retry(settlementRetry))

      return [yield* Fiber.join(rejected), yield* Fiber.join(canceled)] as const
    }), ClientLive)

    assert.deepStrictEqual(outputs, ["reject", "cancel"])
  })

  it("mirrors the raw promises namespace without changing SDK records", async () => {
    const ClientLive = ResonateClient.layer({
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(localNetworkLayer(() => new LocalNetwork())))

    const records = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const created = yield* client.promises.create(
        "raw-promise-1",
        Date.now() + 60_000,
        {
          headers: { source: "integration" },
          data: "before",
          tags: { kind: "raw" }
        }
      )
      const loaded = yield* client.promises.get(created.id)
      const resolved = yield* client.promises.resolve(
        created.id,
        {
          headers: { source: "integration" },
          data: "after"
        }
      )
      const rejectedPromise = yield* client.promises.create("raw-reject-1", Date.now() + 60_000)
      const rejected = yield* client.promises.reject(rejectedPromise.id, { data: "declined" })
      const canceledPromise = yield* client.promises.create("raw-cancel-1", Date.now() + 60_000)
      const canceled = yield* client.promises.cancel(canceledPromise.id, { data: "withdrawn" })
      const withTask = yield* client.promises.createWithTask(
        "raw-task-1",
        Date.now() + 60_000,
        "worker-1",
        30_000,
        { tags: { "resonate:target": "poll://any@integration" } }
      )
      const awaited = yield* client.promises.create(
        "raw-awaited-1",
        Date.now() + 60_000,
        { tags: { "resonate:external": "true" } }
      )
      const awaiter = yield* client.promises.create(
        "raw-awaiter-1",
        Date.now() + 60_000,
        { tags: { "resonate:target": "poll://any@integration" } }
      )
      const callback = yield* client.promises.registerCallback(awaited.id, awaiter.id)
      const listener = yield* client.promises.registerListener(awaited.id, "local://integration-listener")
      return { created, loaded, resolved, rejected, canceled, withTask, callback, listener }
    }), ClientLive)

    assert.strictEqual(records.created.state, "pending")
    assert.deepStrictEqual(records.loaded.param, {
      headers: { source: "integration" },
      data: "before"
    })
    assert.deepInclude(records.resolved, {
      id: "raw-promise-1",
      state: "resolved",
      value: {
        headers: { source: "integration" },
        data: "after"
      }
    })
    assert.deepInclude(records.rejected, {
      id: "raw-reject-1",
      state: "rejected",
      value: { headers: {}, data: "declined" }
    })
    assert.deepInclude(records.canceled, {
      id: "raw-cancel-1",
      state: "rejected_canceled",
      value: { headers: {}, data: "withdrawn" }
    })
    assert.deepInclude(records.withTask.promise, {
      id: "raw-task-1",
      state: "pending"
    })
    assert.deepInclude(records.withTask.task, {
      id: "raw-task-1",
      state: "acquired",
      pid: "worker-1"
    })
    assert.strictEqual(records.callback.promise.id, "raw-awaited-1")
    assert.strictEqual(records.listener.promise.id, "raw-awaited-1")
  })

  it("mirrors the raw schedules namespace", async () => {
    const ClientLive = ResonateClient.layer({
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(localNetworkLayer(() => new LocalNetwork())))

    const output = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const options = yield* client.options()
      const created = yield* client.schedules.create(
        "raw-schedule-1",
        "0 0 * * *",
        "scheduled-promise-{{.timestamp}}",
        60_000,
        {
          promiseHeaders: { source: "integration" },
          promiseData: "scheduled",
          promiseTags: {
            kind: "raw",
            "resonate:target": options.target
          }
        }
      )
      const loaded = yield* client.schedules.get(created.id)
      const deleted = yield* client.schedules.delete(created.id)
      return { created, loaded, deleted }
    }), ClientLive)

    assert.strictEqual(output.created.id, "raw-schedule-1")
    assert.deepStrictEqual(output.loaded, output.created)
    assert.isUndefined(output.deleted)
  })

  it("rejects malformed promise resolution before invoking the SDK", async () => {
    const Ping = Workflow.make({
      name: "client.invalid-resolution",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Ping)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const failure = await runWith(Effect.flip(
      ResonateClient.promises.resolve("does-not-need-to-exist", Schema.String, 42 as unknown as string)
    ), ClientLive)

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/DurableProtocolError",
      issue: "PayloadEncodeFailed"
    })
  })

  it("preserves the first external settlement across duplicate and late attempts", async () => {
    const First = Workflow.make({
      name: "client.first-settlement",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(First)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      First.toLayer(async (context) => Result.succeed(await context.promise(Schema.String)))
    )))
    const settlementRetry = {
      schedule: Schedule.spaced(Duration.millis(1)),
      times: 50
    }

    const output = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run("first-settlement", First, null)
      const running = yield* handle.result().pipe(Effect.forkChild)
      yield* client.promises.resolve("first-settlement:0", Schema.String, "first").pipe(
        Effect.retry(settlementRetry)
      )
      yield* client.promises.resolve("first-settlement:0", Schema.String, "second")
      const result = yield* Fiber.join(running)
      yield* client.promises.reject("first-settlement:0", Schema.String, "late")
      return result
    }), ClientLive)

    assert.strictEqual(output, "first")
  })

  it("preserves a durable timeout when external resolution arrives late", async () => {
    const Timeout = Workflow.make({
      name: "client.timeout-settlement-race",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Timeout)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Timeout.toLayer(async (context) => Result.succeed(await context.promise(Schema.String)))
    )))

    const failure = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run("timeout-settlement-race", Timeout, null, { timeout: 20 })
      const running = yield* Effect.flip(handle.result()).pipe(Effect.forkChild)

      // LocalNetwork advances durable time on a one-second tick.
      yield* Effect.sleep(Duration.millis(1_100))
      yield* client.promises.resolve("timeout-settlement-race:0", Schema.String, "too-late")
      return yield* Fiber.join(running)
    }), ClientLive)

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/ResonateSdkError",
      operation: "handle.result",
      requestMayHaveCommitted: true
    })
  })

  it("keeps durable execution alive when the local run waiter is interrupted", async () => {
    let notifyWaiting!: () => void
    const waiting = new Promise<void>((resolve) => {
      notifyWaiting = resolve
    })
    const Wait = Workflow.make({
      name: "client.interrupted-waiter",
      version: 1,
      input: Schema.Null,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Wait)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Wait.toLayer(async (context) => {
        const durable = context.promise(Schema.String)
        notifyWaiting()
        return Result.succeed(await durable)
      })
    )))

    const output = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run("interrupted-waiter", Wait, null)
      const localWaiter = yield* handle.result().pipe(Effect.forkChild)
      yield* Effect.promise(() => waiting)
      yield* Fiber.interrupt(localWaiter)
      yield* client.promises.resolve("interrupted-waiter:0", Schema.String, "still-running").pipe(Effect.retry({
        schedule: Schedule.spaced(Duration.millis(1)),
        times: 50
      }))
      const attached = yield* client.get("interrupted-waiter", Wait)
      return yield* attached.result()
    }), ClientLive)

    assert.strictEqual(output, "still-running")
  })

  it("recovers by attachment after the result-listener response is lost", async () => {
    const responseLost = new Error("response lost after commit")
    const network = new LocalNetwork()
    const send = network.send
    let loseListenerResponse = true
    network.send = (async (request) => {
      const response = await send(request)
      if (loseListenerResponse && request.kind === "promise.register_listener") {
        loseListenerResponse = false
        throw responseLost
      }
      return response
    }) as typeof network.send
    const Echo = Workflow.make({
      name: "client.response-loss",
      version: 1,
      input: Schema.String,
      success: Schema.String,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Echo)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => network),
      Echo.toLayer(async (_context, input) => Result.succeed(input))
    )))

    const [failure, recovered] = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run("response-loss", Echo, "committed")
      const failed = yield* Effect.flip(handle.result())
      const attached = yield* client.get("response-loss", Echo)
      return [failed, yield* attached.result()] as const
    }), ClientLive)

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/ResonateSdkError",
      operation: "handle.result",
      requestMayHaveCommitted: true
    })
    assert.strictEqual(failure.cause, responseLost)
    assert.strictEqual(recovered, "committed")
  })

  it("validates acquisition before constructing the provider network", async () => {
    const Invalid = Workflow.make({
      name: "invalid.client",
      version: Number.NaN,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Invalid)
    let constructions = 0
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => {
        constructions += 1
        return new LocalNetwork()
      }),
      Invalid.toLayer(async () => Result.succeed(null))
    )))

    const failure = await Effect.runPromise(Effect.flip(
      ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
    ))

    assert.strictEqual(failure._tag, "@effect-resonate/core/InvalidDefinition")
    assert.strictEqual(constructions, 0)
  })

  it("rejects invalid drain configuration before constructing the provider network", async () => {
    const Ping = Workflow.make({
      name: "invalid.client.config",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Ping)
    let constructions = 0
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Number.NaN
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => {
        constructions += 1
        return new LocalNetwork()
      }),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const failure = await Effect.runPromise(Effect.flip(
      ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
    ))

    assert.strictEqual(failure._tag, "@effect-resonate/core/InvalidClientConfiguration")
    assert.strictEqual(constructions, 0)
  })

  it("preserves a provider factory failure without constructing the SDK", async () => {
    const cause = new Error("provider factory failed")
    const providerError = new ResonateSdkError({
      operation: "network.init",
      cause,
      requestMayHaveCommitted: false
    })
    const Ping = Workflow.make({
      name: "client.provider-factory",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Ping)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      ResonateNetwork.make({ factory: Effect.fail(providerError) }),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const failure = await Effect.runPromise(Effect.flip(
      ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
    ))

    assert.strictEqual(failure, providerError)
    assert.strictEqual(failure.cause, cause)
  })

  it("fails acquisition on network readiness failure and releases the network", async () => {
    const readinessCause = new Error("provider sentinel")
    let stops = 0
    class FailingNetwork extends LocalNetwork {
      override init(): Promise<void> {
        return Promise.reject(readinessCause)
      }

      override stop(): Promise<void> {
        stops += 1
        return Promise.resolve()
      }
    }
    const Ping = Workflow.make({
      name: "client.readiness",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Ping)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new FailingNetwork()),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const failure = await Effect.runPromise(Effect.flip(
      ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
    ))

    assert.strictEqual(failure._tag, "@effect-resonate/core/ResonateSdkError")
    assert.strictEqual(failure.operation, "network.init")
    assert.strictEqual(failure.cause, readinessCause)
    assert.strictEqual(stops, 1)
  })

  it("shares one shutdown across repeated explicit stop calls and Layer release", async () => {
    let initializations = 0
    let stops = 0
    class ObservedNetwork extends LocalNetwork {
      override init(): Promise<void> {
        initializations += 1
        return super.init()
      }

      override stop(): Promise<void> {
        stops += 1
        return super.stop()
      }
    }
    const Ping = Workflow.make({
      name: "client.lifecycle",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Ping)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new ObservedNetwork()),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const runtime = ManagedRuntime.make(ClientLive)
    const client = await runtime.runPromise(ResonateClient.ResonateClient)
    const handle = await runtime.runPromise(client.run("lifecycle-1", Ping, null))
    await runtime.runPromise(handle.result())
    await runtime.runPromise(client.stop())
    await runtime.runPromise(client.stop())
    await runtime.dispose()

    assert.strictEqual(initializations, 1)
    assert.strictEqual(stops, 1)
  })

  it("continues shared shutdown when one explicit stop waiter is interrupted", async () => {
    let stops = 0
    let notifyStarted!: () => void
    let unblock!: () => void
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const blocked = new Promise<null>((resolve) => {
      unblock = () => resolve(null)
    })
    class ObservedNetwork extends LocalNetwork {
      override stop(): Promise<void> {
        stops += 1
        return super.stop()
      }
    }
    const Blocked = Step.make({
      name: "client.interrupted-stop-step",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Wait = Workflow.make({
      name: "client.interrupted-stop-workflow",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Blocked, Wait)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.mergeAll(
      localNetworkLayer(() => new ObservedNetwork()),
      Blocked.toLayer(() => Effect.sync(notifyStarted).pipe(
        Effect.andThen(Effect.promise(() => blocked))
      )),
      Wait.toLayer(async (context) => context.run(Blocked, null))
    )))
    const runtime = ManagedRuntime.make(ClientLive)
    const client = await runtime.runPromise(ResonateClient.ResonateClient)
    const running = runtime.runPromise(Effect.gen(function*() {
      const handle = yield* client.run("interrupted-stop-1", Wait, null)
      return yield* handle.result()
    })).catch(() => undefined)
    void running

    await started
    await runtime.runPromise(Effect.gen(function*() {
      const interruptedWaiter = yield* client.stop().pipe(Effect.forkChild)
      yield* Effect.sleep(Duration.millis(10))
      const completingWaiter = yield* client.stop().pipe(Effect.forkChild)
      yield* Fiber.interrupt(interruptedWaiter)
      yield* Effect.sync(unblock)
      yield* Fiber.join(completingWaiter)
    }))
    await runtime.dispose()

    assert.strictEqual(stops, 1)
  })

  it("fences an admitted step after the drain deadline before stopping the network", async () => {
    const events: Array<string> = []
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    class ObservedNetwork extends LocalNetwork {
      override stop(): Promise<void> {
        events.push("network-stop")
        return super.stop()
      }
    }
    const Blocked = Step.make({
      name: "client.blocked",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const Wait = Workflow.make({
      name: "client.wait",
      version: 1,
      input: Schema.Null,
      success: Schema.Never,
      failure: Schema.Never
    })
    const Functions = ResonateFunctions.make(Blocked, Wait)
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.zero
    }).pipe(Layer.provide(Layer.mergeAll(
      localNetworkLayer(() => new ObservedNetwork()),
      Blocked.toLayer(() => Effect.acquireUseRelease(
        Effect.sync(notifyStarted),
        () => Effect.never,
        () => Effect.sync(() => events.push("step-finalizer"))
      )),
      Wait.toLayer(async (context) => context.run(Blocked, null))
    )))
    const runtime = ManagedRuntime.make(ClientLive)
    const client = await runtime.runPromise(ResonateClient.ResonateClient)
    const running = runtime.runPromise(Effect.gen(function*() {
      const handle = yield* client.run("blocked-1", Wait, null)
      return yield* handle.result()
    })).catch(() => undefined)

    await started
    await runtime.dispose()
    await running

    assert.deepStrictEqual(events, ["step-finalizer", "network-stop"])
  })
})
