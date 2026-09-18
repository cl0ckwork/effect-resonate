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
    class Functions extends ResonateFunctions.make(Uppercase, Echo) {}

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
      const handle = yield* ResonateClient.run({
        workflow: Echo,
        id: "echo-1",
        input: "hello"
      })
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

    const output = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      yield* client.setDependency({ name: "prefix", value: "raw:" })
      const registered = yield* client.register({
        name: "raw.uppercase",
        func: Uppercase,
        options: { version: 1 }
      })
      const options = yield* registered.options({ version: 1 })
      const helperHandle = yield* registered.run({
        id: "raw-helper-1",
        args: ["helper"]
      })
      const rawHandle = yield* client.run({
        id: "raw-run-1",
        func: "raw.uppercase",
        args: ["client"],
        options
      })
      const rpcHandle = yield* client.rpc({
        id: "raw-rpc-1",
        func: "raw.uppercase",
        args: ["remote"],
        options
      })
      const attached = yield* client.get<string>({ id: rawHandle.id })

      return {
        helper: yield* helperHandle.result(),
        raw: yield* attached.result(),
        done: yield* rawHandle.done(),
        rpcId: rpcHandle.id,
        rpc: yield* rpcHandle.result(),
        rpcDone: yield* rpcHandle.done()
      }
    }), ClientLive)

    assert.deepStrictEqual(output, {
      helper: "raw:HELPER",
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
    class Functions extends ResonateFunctions.make(Decline) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Decline.toLayer(async () => Result.fail({ reason: "declined" }))
    )))

    const failure = await runWith(Effect.gen(function*() {
      const handle = yield* ResonateClient.run({
        workflow: Decline,
        id: "decline-1",
        input: null
      })
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
    class Functions extends ResonateFunctions.make(Echo) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Echo.toLayer(async (_context, input) => Result.succeed(input))
    )))

    const outputs = await runWith(Effect.gen(function*() {
      const first = yield* ResonateClient.run({ workflow: Echo, id: "first-writer-1", input: "first" })
      const second = yield* ResonateClient.run({ workflow: Echo, id: "first-writer-1", input: "second" })
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
    class Functions extends ResonateFunctions.make(V1, V2) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.mergeAll(
      localNetworkLayer(() => new LocalNetwork()),
      V1.toLayer(async () => Result.succeed("v1")),
      V2.toLayer(async () => Result.succeed("v2"))
    )))

    const failure = await runWith(Effect.gen(function*() {
      const started = yield* ResonateClient.run({ workflow: V1, id: "versioned-1", input: null })
      yield* started.result()
      const attached = yield* ResonateClient.get({ workflow: V2, id: "versioned-1" })
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

  it("surfaces an absent attachment as a non-committing SDK lookup error", async () => {
    const Missing = Workflow.make({
      name: "client.missing",
      version: 1,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })
    class Functions extends ResonateFunctions.make(Missing) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Missing.toLayer(async () => Result.succeed(null))
    )))

    const failure = await runWith(
      Effect.flip(ResonateClient.get({
        workflow: Missing,
        id: "not-found"
      })),
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
    class Functions extends ResonateFunctions.make(Approval) {}
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

    const [output, invalidCancellation] = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run({
        workflow: Approval,
        id: "approval-1",
        input: null
      })
      const running = yield* handle.result().pipe(Effect.forkChild)
      yield* client.promises.resolve({
        id: "approval-1:0",
        schema: ApprovalValue,
        value: { approved: true }
      }).pipe(Effect.retry({
        schedule: Schedule.spaced(Duration.millis(1)),
        times: 50
      }))
      const result = yield* Fiber.join(running)
      const invalid = yield* Effect.flip(client.promises.cancel({
        id: "approval-1:0",
        schema: Schema.Struct({ nonDurable: Schema.Undefined }),
        value: { nonDurable: undefined }
      }))
      return [result, invalid] as const
    }), ClientLive)

    assert.isTrue(output)
    assert.deepInclude(invalidCancellation, {
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
    class Functions extends ResonateFunctions.make(Settlement) {}
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
      const rejectedHandle = yield* client.run({
        workflow: Settlement,
        id: "settle-reject",
        input: "reject"
      })
      const rejected = yield* rejectedHandle.result().pipe(Effect.forkChild)
      yield* client.promises.reject({
        id: "settle-reject:0",
        schema: Schema.Struct({ reason: Schema.String }),
        value: { reason: "declined" }
      }).pipe(Effect.retry(settlementRetry))

      const canceledHandle = yield* client.run({
        workflow: Settlement,
        id: "settle-cancel",
        input: "cancel"
      })
      const canceled = yield* canceledHandle.result().pipe(Effect.forkChild)
      yield* client.promises.cancel({
        id: "settle-cancel:0",
        schema: Schema.Struct({ reason: Schema.String }),
        value: { reason: "withdrawn" }
      }).pipe(Effect.retry(settlementRetry))

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
      const created = yield* client.promises.create({
        id: "raw-promise-1",
        timeoutAt: Date.now() + 60_000,
        options: {
          headers: { source: "integration" },
          data: "before",
          tags: { kind: "raw" }
        }
      })
      const loaded = yield* client.promises.get({ id: created.id })
      const resolved = yield* client.promises.resolve({
        id: created.id,
        options: {
          headers: { source: "integration" },
          data: "after"
        }
      })
      return { created, loaded, resolved }
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
  })

  it("mirrors the raw schedules namespace", async () => {
    const ClientLive = ResonateClient.layer({
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(localNetworkLayer(() => new LocalNetwork())))

    const output = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const options = yield* client.options()
      const created = yield* client.schedules.create({
        id: "raw-schedule-1",
        cron: "0 0 * * *",
        promiseId: "scheduled-promise-{{.timestamp}}",
        promiseTimeout: 60_000,
        options: {
          promiseHeaders: { source: "integration" },
          promiseData: "scheduled",
          promiseTags: {
            kind: "raw",
            "resonate:target": options.target
          }
        }
      })
      const loaded = yield* client.schedules.get({ id: created.id })
      const deleted = yield* client.schedules.delete({ id: created.id })
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
    class Functions extends ResonateFunctions.make(Ping) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const failure = await runWith(Effect.flip(
      ResonateClient.promises.resolve({
        id: "does-not-need-to-exist",
        schema: Schema.String,
        value: 42 as unknown as string
      })
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
    class Functions extends ResonateFunctions.make(First) {}
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
      const handle = yield* client.run({
        workflow: First,
        id: "first-settlement",
        input: null
      })
      const running = yield* handle.result().pipe(Effect.forkChild)
      yield* client.promises.resolve({
        id: "first-settlement:0",
        schema: Schema.String,
        value: "first"
      }).pipe(Effect.retry(settlementRetry))
      yield* client.promises.resolve({
        id: "first-settlement:0",
        schema: Schema.String,
        value: "second"
      })
      const result = yield* Fiber.join(running)
      yield* client.promises.reject({
        id: "first-settlement:0",
        schema: Schema.String,
        value: "late"
      })
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
    class Functions extends ResonateFunctions.make(Timeout) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new LocalNetwork()),
      Timeout.toLayer(async (context) => Result.succeed(await context.promise(Schema.String)))
    )))

    const failure = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run({
        workflow: Timeout,
        id: "timeout-settlement-race",
        input: null,
        options: { timeout: 20 }
      })
      const running = yield* Effect.flip(handle.result()).pipe(Effect.forkChild)

      // LocalNetwork advances durable time on a one-second tick.
      yield* Effect.sleep(Duration.millis(1_100))
      yield* client.promises.resolve({
        id: "timeout-settlement-race:0",
        schema: Schema.String,
        value: "too-late"
      })
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
    class Functions extends ResonateFunctions.make(Wait) {}
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
      const handle = yield* client.run({
        workflow: Wait,
        id: "interrupted-waiter",
        input: null
      })
      const localWaiter = yield* handle.result().pipe(Effect.forkChild)
      yield* Effect.promise(() => waiting)
      yield* Fiber.interrupt(localWaiter)
      yield* client.promises.resolve({
        id: "interrupted-waiter:0",
        schema: Schema.String,
        value: "still-running"
      }).pipe(Effect.retry({
        schedule: Schedule.spaced(Duration.millis(1)),
        times: 50
      }))
      const attached = yield* client.get({ workflow: Wait, id: "interrupted-waiter" })
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
    class Functions extends ResonateFunctions.make(Echo) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => network),
      Echo.toLayer(async (_context, input) => Result.succeed(input))
    )))

    const [failure, recovered] = await runWith(Effect.gen(function*() {
      const client = yield* ResonateClient.ResonateClient
      const handle = yield* client.run({
        workflow: Echo,
        id: "response-loss",
        input: "committed"
      })
      const failed = yield* Effect.flip(handle.result())
      const attached = yield* client.get({ workflow: Echo, id: "response-loss" })
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
    class Functions extends ResonateFunctions.make(Invalid) {}
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
    class Functions extends ResonateFunctions.make(Ping) {}
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
    class Functions extends ResonateFunctions.make(Ping) {}
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
    class Functions extends ResonateFunctions.make(Ping) {}
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
    class Functions extends ResonateFunctions.make(Ping) {}
    const ClientLive = ResonateClient.layer({
      functions: Functions,
      drainTimeout: Duration.seconds(1)
    }).pipe(Layer.provide(Layer.merge(
      localNetworkLayer(() => new ObservedNetwork()),
      Ping.toLayer(async () => Result.succeed(null))
    )))

    const runtime = ManagedRuntime.make(ClientLive)
    const client = await runtime.runPromise(ResonateClient.ResonateClient)
    const handle = await runtime.runPromise(client.run({
      workflow: Ping,
      id: "lifecycle-1",
      input: null
    }))
    await runtime.runPromise(handle.result())
    await runtime.runPromise(client.stop())
    await runtime.runPromise(client.stop())
    await runtime.dispose()

    assert.strictEqual(initializations, 1)
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
    class Functions extends ResonateFunctions.make(Blocked, Wait) {}
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
      const handle = yield* client.run({
        workflow: Wait,
        id: "blocked-1",
        input: null
      })
      return yield* handle.result()
    })).catch(() => undefined)

    await started
    await runtime.dispose()
    await running

    assert.deepStrictEqual(events, ["step-finalizer", "network-stop"])
  })
})
