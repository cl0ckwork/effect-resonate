import { Context, Duration, Effect, Layer, Option, Ref, Schema, Scope } from "effect"

export const ExecutionState = Schema.Literals([
  "pending",
  "resolved",
  "rejected",
  "rejected_canceled",
  "rejected_timedout",
  "unknown"
])

export type ExecutionState = typeof ExecutionState.Type

export interface ExecutionObservation {
  readonly id: string
  readonly state: ExecutionState
}

export interface NetworkObservation {
  readonly phase: "ready" | "stopped" | "degraded" | "unknown"
  readonly activeWorkers: number
  readonly executions: ReadonlyArray<ExecutionObservation>
}

export interface ObservationRequest {
  readonly executionIds: ReadonlyArray<string>
}

export interface HarnessTiming {
  readonly pollInterval: Duration.Input
  readonly scenarioTimeout: Duration.Input
}

export interface TimeoutCapability {
  /** Durable timeout supplied to the root invocation. */
  readonly invocationTimeoutMillis: number
}

/** Semantic features a scenario may require without naming provider mechanics. */
export interface HarnessCapabilities {
  /** Durable state can be observed by a new worker after the first worker stops. */
  readonly recovery?: true
  /** Durable deadlines advance while a worker is connected. */
  readonly timeout?: TimeoutCapability
  /** The SDK rejects a durable operation issued after an ordinary await. */
  readonly invalidNonDurableAwait?: true
}

export interface NetworkHarnessResource {
  readonly timing: HarnessTiming
  readonly capabilities: HarnessCapabilities
  /** Returns only allowlisted structural state. Implementations must absorb provider diagnostic failures. */
  readonly observe: (request: ObservationRequest) => Effect.Effect<NetworkObservation>
}

export interface NetworkHarnessService extends NetworkHarnessResource {
  readonly name: string
  readonly nextExecutionId: (request: { readonly scenario: string }) => Effect.Effect<string>
}

/** One scoped, isolated provider state used by conformance scenarios. */
export class NetworkHarness extends Context.Service<NetworkHarness, NetworkHarnessService>()(
  "@effect-resonate/testing/NetworkHarness"
) {}

export class HarnessSetupError extends Schema.TaggedError<HarnessSetupError>()(
  "@effect-resonate/testing/HarnessSetupError",
  {
    harness: Schema.String,
    issue: Schema.Literals(["AcquisitionFailed", "TimedOut"])
  }
) {}

export const ConformanceIssue = Schema.Literals([
  "AssertionFailed",
  "MissingCapability",
  "ObservationFailed",
  "TimedOut",
  "WorkerFailed",
  "CleanupFailed"
])

export type ConformanceIssue = typeof ConformanceIssue.Type

const ExecutionDiagnostic = Schema.Struct({
  id: Schema.String,
  state: ExecutionState
})

const ObservationDiagnostic = Schema.Struct({
  phase: Schema.Literals(["ready", "stopped", "degraded", "unknown"]),
  activeWorkers: Schema.Int,
  executions: Schema.Array(ExecutionDiagnostic)
})

/** A failure whose diagnostic payload cannot contain provider causes, messages, URLs, or raw durable values. */
export class ConformanceFailure extends Schema.TaggedError<ConformanceFailure>()(
  "@effect-resonate/testing/ConformanceFailure",
  {
    harness: Schema.String,
    scenario: Schema.String,
    issue: ConformanceIssue,
    assertion: Schema.String,
    observation: ObservationDiagnostic
  }
) {}

export interface MakeLayerOptions<Error, Requirements> {
  readonly name: string
  readonly setupTimeout: Duration.Input
  readonly acquire: Effect.Effect<NetworkHarnessResource, Error, Requirements>
}

/**
 * Adapts provider-owned scoped setup into the shared service. Provider errors
 * are deliberately collapsed before they can enter conformance diagnostics.
 */
export const layer = <Error, Requirements>(
  options: MakeLayerOptions<Error, Requirements>
): Layer.Layer<NetworkHarness, HarnessSetupError, Exclude<Requirements, Scope.Scope>> => Layer.effect(
  NetworkHarness,
  Effect.gen(function*() {
    const acquired = yield* options.acquire.pipe(
      Effect.mapError(() => new HarnessSetupError({
        harness: options.name,
        issue: "AcquisitionFailed"
      })),
      Effect.timeoutOption(options.setupTimeout)
    )
    const resource = yield* Option.match(acquired, {
      onNone: () => new HarnessSetupError({ harness: options.name, issue: "TimedOut" }),
      onSome: Effect.succeed
    })
    const counter = yield* Ref.make(0)

    return NetworkHarness.of({
      ...resource,
      name: options.name,
      nextExecutionId: ({ scenario }) => Ref.updateAndGet(counter, (value) => value + 1).pipe(
        Effect.map((value) => `${scenario}-${value}`)
      )
    })
  })
)

export interface FailureOptions {
  readonly scenario: string
  readonly issue: ConformanceIssue
  readonly assertion: string
  readonly executionIds?: ReadonlyArray<string>
}

const fallbackObservation = (options: {
  readonly executionIds: ReadonlyArray<string>
}): NetworkObservation => ({
  phase: "unknown",
  activeWorkers: 0,
  executions: options.executionIds.map((id) => ({ id, state: "unknown" }))
})

export const fail = (options: FailureOptions): Effect.Effect<never, ConformanceFailure, NetworkHarness> =>
  NetworkHarness.use((harness) => {
    const executionIds = options.executionIds ?? []
    return harness.observe({ executionIds }).pipe(
      Effect.catchCause(() => Effect.succeed(fallbackObservation({ executionIds }))),
      Effect.timeoutOption(harness.timing.scenarioTimeout),
      Effect.map(Option.getOrElse(() => fallbackObservation({ executionIds }))),
      Effect.flatMap((observation) => new ConformanceFailure({
      harness: harness.name,
      scenario: options.scenario,
      issue: options.issue,
      assertion: options.assertion,
      observation
      }))
    )
  })

export interface AssertOptions extends Omit<FailureOptions, "issue"> {
  readonly condition: boolean
}

export const assertConformance = (options: AssertOptions): Effect.Effect<void, ConformanceFailure, NetworkHarness> =>
  options.condition
    ? Effect.void
    : fail({
      scenario: options.scenario,
      issue: "AssertionFailed",
      assertion: options.assertion,
      ...(options.executionIds === undefined ? {} : { executionIds: options.executionIds })
    })

export interface WaitForOptions<Success, Error, Requirements> {
  readonly scenario: string
  readonly assertion: string
  readonly executionIds?: ReadonlyArray<string>
  readonly poll: Effect.Effect<Option.Option<Success>, Error, Requirements>
}

/** Polls an observable boundary until it yields a value, with the harness-wide finite deadline. */
export const waitFor = <Success, Error, Requirements>(
  options: WaitForOptions<Success, Error, Requirements>
): Effect.Effect<Success, ConformanceFailure, Requirements | NetworkHarness> => Effect.gen(function*() {
  const harness = yield* NetworkHarness
  const onFailure = (issue: ConformanceIssue) => fail({
    scenario: options.scenario,
    issue,
    assertion: options.assertion,
    ...(options.executionIds === undefined ? {} : { executionIds: options.executionIds })
  })
  const poll = (): Effect.Effect<Success, ConformanceFailure, Requirements | NetworkHarness> =>
    options.poll.pipe(
      Effect.catch(() => onFailure("ObservationFailed")),
      Effect.flatMap(Option.match({
        onNone: () => Effect.sleep(harness.timing.pollInterval).pipe(Effect.andThen(Effect.suspend(poll))),
        onSome: Effect.succeed
      }))
    )
  const bounded = yield* poll().pipe(Effect.timeoutOption(harness.timing.scenarioTimeout))

  return yield* Option.match(bounded, {
    onNone: () => onFailure("TimedOut"),
    onSome: Effect.succeed
  })
})
