import { assert, describe, it } from "@effect/vitest"
import { Cause, Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Match } from "effect"
import { AdapterSupervisor, type Completion } from "../AdapterSupervisor.js"

const makeRuntime = () => ManagedRuntime.make(AdapterSupervisor.layer)

const completedExit = <A, E>(completion: Completion<A, E>): Exit.Exit<A, E> =>
  Match.valueTags(completion, {
    Fenced: () => {
      throw new Error("expected supervised completion")
    },
    Completed: ({ exit }) => exit
  })

const expectFenced = <A, E>(completion: Completion<A, E>): void =>
  Match.valueTags(completion, {
    Fenced: () => undefined,
    Completed: () => {
      throw new Error("expected fenced completion")
    }
  })

describe("AdapterSupervisor", () => {
  it("captures success without changing its value", async () => {
    const runtime = makeRuntime()
    await runtime.context()

    const completion = await runtime.runPromise(
      Effect.succeed(42).pipe(AdapterSupervisor.supervise)
    )

    assert.deepStrictEqual(completedExit(completion), Exit.succeed(42))
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 0)
    await runtime.dispose()
  })

  it("captures checked failures in Exit instead of the supervisor error channel", async () => {
    const runtime = makeRuntime()
    await runtime.context()

    const completion = await runtime.runPromise(
      Effect.fail({ reason: "declined" }).pipe(AdapterSupervisor.supervise)
    )

    assert.deepStrictEqual(completedExit(completion), Exit.fail({ reason: "declined" }))
    await runtime.dispose()
  })

  it("captures defects without rejecting the supervisor program", async () => {
    const runtime = makeRuntime()
    await runtime.context()

    const exit = completedExit(
      await runtime.runPromise(Effect.die("boom").pipe(AdapterSupervisor.supervise))
    )

    assert.isTrue(Exit.isFailure(exit))
    if (Exit.isFailure(exit)) {
      assert.isTrue(Cause.hasDies(exit.cause))
    }
    await runtime.dispose()
  })

  it("captures deliberate interruption without confusing it with abandonment", async () => {
    const runtime = makeRuntime()
    await runtime.context()

    const exit = completedExit(
      await runtime.runPromise(Effect.interrupt.pipe(AdapterSupervisor.supervise))
    )

    assert.isTrue(Exit.isFailure(exit))
    if (Exit.isFailure(exit)) {
      assert.isTrue(Cause.hasInterruptsOnly(exit.cause))
    }
    await runtime.dispose()
  })

  it("runs heterogeneous work with the application service context", async () => {
    class Prefix extends Context.Service<Prefix, string>()("test/Prefix") {}
    const runtime = ManagedRuntime.make(
      Layer.merge(AdapterSupervisor.layer, Layer.succeed(Prefix, "reservation"))
    )
    await runtime.context()
    const release = Effect.runSync(Deferred.make<void>())

    const text = runtime.runPromise(
      Deferred.await(release).pipe(
        Effect.andThen(Prefix.use((prefix) => Effect.succeed(`${prefix}-1`))),
        AdapterSupervisor.supervise
      )
    )
    const number = runtime.runPromise(
      Deferred.await(release).pipe(Effect.as(42), AdapterSupervisor.supervise)
    )

    await Promise.resolve()
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 2)
    const draining = runtime.runPromise(AdapterSupervisor.drain)
    const beforeRelease = await Promise.race([
      draining.then(() => "drained" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 5))
    ])
    assert.strictEqual(beforeRelease, "waiting")

    await Effect.runPromise(Deferred.succeed(release, undefined))
    await draining
    assert.deepStrictEqual(completedExit(await text), Exit.succeed("reservation-1"))
    assert.deepStrictEqual(completedExit(await number), Exit.succeed(42))
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 0)
    await runtime.dispose()
  })

  it("closes admission idempotently without evaluating denied effects", async () => {
    const runtime = makeRuntime()
    await runtime.context()
    let executions = 0

    await runtime.runPromise(AdapterSupervisor.close)
    await runtime.runPromise(AdapterSupervisor.close)
    const completion = await runtime.runPromise(
      Effect.sync(() => {
        executions += 1
        return "unreachable"
      }).pipe(AdapterSupervisor.supervise)
    )

    expectFenced(completion)
    assert.strictEqual(executions, 0)
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 0)
    await runtime.dispose()
  })

  it("allows admitted work to finish after closing while denying later work", async () => {
    const runtime = makeRuntime()
    await runtime.context()
    const release = Effect.runSync(Deferred.make<void>())
    const admitted = runtime.runPromise(
      Deferred.await(release).pipe(Effect.as("finished"), AdapterSupervisor.supervise)
    )

    await Promise.resolve()
    await runtime.runPromise(AdapterSupervisor.close)
    const denied = await runtime.runPromise(
      Effect.succeed("late").pipe(AdapterSupervisor.supervise)
    )
    expectFenced(denied)

    await Effect.runPromise(Deferred.succeed(release, undefined))
    assert.deepStrictEqual(completedExit(await admitted), Exit.succeed("finished"))
    await runtime.runPromise(AdapterSupervisor.drain)
    await runtime.dispose()
  })

  it("fences and interrupts abandoned work before drain completes", async () => {
    const runtime = makeRuntime()
    await runtime.context()
    const completion = runtime.runPromise(Effect.never.pipe(AdapterSupervisor.supervise))

    await Promise.resolve()
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 1)
    await runtime.runPromise(AdapterSupervisor.abandon)
    expectFenced(await completion)
    await runtime.runPromise(AdapterSupervisor.drain)
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 0)
    await runtime.dispose()
  })

  it("requests abandonment idempotently without waiting for uninterruptible cleanup", async () => {
    const runtime = makeRuntime()
    await runtime.context()
    const release = Effect.runSync(Deferred.make<void>())
    const completion = runtime.runPromise(
      Effect.uninterruptible(Deferred.await(release)).pipe(AdapterSupervisor.supervise)
    )

    await Promise.resolve()
    const request = Promise.all([
      runtime.runPromise(AdapterSupervisor.abandon),
      runtime.runPromise(AdapterSupervisor.abandon)
    ])
    const observation = await Promise.race([
      request.then(() => "requested" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 5))
    ])
    assert.strictEqual(observation, "requested")

    await Effect.runPromise(Deferred.succeed(release, undefined))
    await request
    expectFenced(await completion)
    await runtime.runPromise(AdapterSupervisor.drain)
    await runtime.dispose()
  })

  it("runs interrupted worker finalizers exactly once before drain completes", async () => {
    const runtime = makeRuntime()
    await runtime.context()
    let releases = 0
    const completion = runtime.runPromise(
      Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          releases += 1
        })
      ).pipe(Effect.andThen(Effect.never), Effect.scoped, AdapterSupervisor.supervise)
    )

    await Promise.resolve()
    assert.strictEqual(await runtime.runPromise(AdapterSupervisor.size), 1)
    await runtime.runPromise(AdapterSupervisor.abandon)
    expectFenced(await completion)
    await runtime.runPromise(AdapterSupervisor.drain)
    assert.strictEqual(releases, 1)

    await runtime.dispose()
    assert.strictEqual(releases, 1)
  })
})
