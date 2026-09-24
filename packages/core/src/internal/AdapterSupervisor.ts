import {
  Context,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  Match,
  Option,
  Ref,
  Semaphore,
  type Scope
} from "effect"

type State = "Open" | "Draining" | "Abandoned"

export type Completion<A, E> =
  { readonly _tag: "Completed"; readonly exit: Exit.Exit<A, E> } | { readonly _tag: "Fenced" }

interface Service {
  readonly supervise: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<Completion<A, E>, never, R>
  readonly close: Effect.Effect<void>
  readonly drain: Effect.Effect<void>
  readonly abandon: Effect.Effect<void>
  readonly size: Effect.Effect<number>
}

const fenced: Completion<never, never> = { _tag: "Fenced" }

// The set is intentionally heterogeneous across registered steps. Each worker
// captures its typed outcome as an Exit and cannot fail in the typed channel.
type SupervisedExit = Exit.Exit<unknown, unknown>

const make = Effect.fnUntraced(function* (): Effect.fn.Return<Service, never, Scope.Scope> {
  const workers = yield* FiberSet.make<SupervisedExit, never>()
  const interruptors = yield* FiberSet.make<void, never>()
  const state = yield* Ref.make<State>("Open")
  const gate = yield* Semaphore.make(1)

  // Registered last so scope release fences before FiberSet finalizers interrupt workers.
  yield* Effect.addFinalizer(() => gate.withPermit(Ref.set(state, "Abandoned")))

  const supervise = Effect.fnUntraced(function* <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.fn.Return<Completion<A, E>, never, R> {
    const admitted = yield* gate.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current !== "Open") {
          return Option.none()
        }

        const worker = yield* FiberSet.run(workers, Effect.exit(effect))
        return Option.some(worker)
      })
    )

    return yield* Option.match(admitted, {
      onNone: () => Effect.succeed(fenced),
      onSome: (worker) =>
        Fiber.await(worker).pipe(
          Effect.flatMap((workerExit) =>
            Ref.get(state).pipe(
              Effect.map((current): Completion<A, E> => {
                if (current === "Abandoned") {
                  return fenced
                }
                return Match.valueTags(workerExit, {
                  Failure: ({ cause }) => ({
                    _tag: "Completed" as const,
                    exit: Exit.failCause(cause)
                  }),
                  Success: ({ value }) => ({ _tag: "Completed" as const, exit: value })
                })
              })
            )
          )
        )
    })
  })

  return {
    supervise,
    close: gate.withPermit(
      Ref.update(state, (current) => (current === "Open" ? "Draining" : current))
    ),
    drain: FiberSet.awaitEmpty(workers).pipe(Effect.andThen(FiberSet.awaitEmpty(interruptors))),
    abandon: gate.withPermit(
      Ref.set(state, "Abandoned").pipe(
        Effect.andThen(FiberSet.run(interruptors, FiberSet.clear(workers))),
        Effect.asVoid
      )
    ),
    size: FiberSet.size(workers)
  }
})

/** Effect-native, scoped supervision for step adapter fibers. */
export class AdapterSupervisor extends Context.Service<AdapterSupervisor, Service>()(
  "@effect-resonate/core/internal/AdapterSupervisor"
) {
  static readonly layer = Layer.effect(AdapterSupervisor, make())

  static readonly supervise = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    AdapterSupervisor.use((service) => service.supervise(effect))

  static readonly close = AdapterSupervisor.use((service) => service.close)
  static readonly drain = AdapterSupervisor.use((service) => service.drain)
  static readonly abandon = AdapterSupervisor.use((service) => service.abandon)
  static readonly size = AdapterSupervisor.use((service) => service.size)
}

/** A fenced adapter intentionally never presents a value for Resonate to checkpoint. */
export const never: Promise<never> = new Promise(() => undefined)
