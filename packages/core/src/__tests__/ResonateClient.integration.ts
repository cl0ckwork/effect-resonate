import { assert, describe, it } from "@effect/vitest"
import { LocalNetwork } from "@resonatehq/sdk"
import { Duration, Effect, Fiber, Layer, ManagedRuntime, Result, Schedule, Schema } from "effect"
import type { Type as DurableValue } from "../DurableValue.js"
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

    const output = await runWith(
      ResonateClient.ResonateClient.use((client) => client.run({
        workflow: Echo,
        id: "echo-1",
        input: "hello"
      })),
      ClientLive
    )

    assert.strictEqual(output, "HELLO")
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

    const failure = await runWith(
      Effect.flip(ResonateClient.ResonateClient.use((client) => client.run({
        workflow: Decline,
        id: "decline-1",
        input: null
      }))),
      ClientLive
    )

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

    const outputs = await runWith(ResonateClient.ResonateClient.use((client) => Effect.gen(function*() {
      const first = yield* client.run({ workflow: Echo, id: "first-writer-1", input: "first" })
      const second = yield* client.run({ workflow: Echo, id: "first-writer-1", input: "second" })
      return [first, second] as const
    })), ClientLive)

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

    const failure = await runWith(ResonateClient.ResonateClient.use((client) => Effect.gen(function*() {
      yield* client.run({ workflow: V1, id: "versioned-1", input: null })
      return yield* Effect.flip(client.attach({ workflow: V2, id: "versioned-1" }))
    })), ClientLive)

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/DefinitionConflict",
      executionId: "versioned-1",
      expectedName: V2.name,
      expectedVersion: V2.version,
      actualName: V1.name,
      actualVersion: V1.version
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
      const running = yield* client.run({
        workflow: Approval,
        id: "approval-1",
        input: null
      }).pipe(Effect.forkChild)
      yield* client.resolvePromise({
        id: "approval-1:0",
        schema: ApprovalValue,
        value: { approved: true }
      }).pipe(Effect.retry({
        schedule: Schedule.spaced(Duration.millis(1)),
        times: 50
      }))
      const result = yield* Fiber.join(running)
      const invalid = yield* Effect.flip(client.cancelPromise({
        id: "approval-1:0",
        reason: { nonDurable: undefined } as unknown as DurableValue
      }))
      return [result, invalid] as const
    }), ClientLive)

    assert.isTrue(output)
    assert.deepInclude(invalidCancellation, {
      _tag: "@effect-resonate/core/InvalidDurableValue",
      location: "PromiseCancellation"
    })
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

  it("awaits network initialization and stops the network exactly once", async () => {
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

    await runWith(
      ResonateClient.ResonateClient.use((client) => client.run({
        workflow: Ping,
        id: "lifecycle-1",
        input: null
      })),
      ClientLive
    )

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
    const running = runtime.runPromise(client.run({
      workflow: Wait,
      id: "blocked-1",
      input: null
    })).catch(() => undefined)

    await started
    await runtime.dispose()
    await running

    assert.deepStrictEqual(events, ["step-finalizer", "network-stop"])
  })
})
