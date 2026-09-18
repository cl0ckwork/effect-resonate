import { Codec } from "@resonatehq/sdk"
import type { ResonateHandle } from "@resonatehq/sdk/async"
import { Constant, Exponential, Linear, Never, Resonate } from "@resonatehq/sdk/async"
import {
  Context,
  Duration,
  Effect,
  Match,
  Option,
  Result,
  type Schema,
  type Scope
} from "effect"
import {
  InvalidClientConfiguration,
  type DurableProtocolError,
  type ExecutionRejected,
  type InvalidDurableValue,
  type ResonateSdkError
} from "../CoreExecutionError.js"
import type { Type as DurableValue } from "../DurableValue.js"
import type { InvocationError, ResonateClientService, LayerOptions } from "../ResonateClient.js"
import type * as ResonateFunctions from "../ResonateFunctions.js"
import { ResonateNetwork } from "../ResonateNetwork.js"
import type * as Step from "../Step.js"
import type { InvocationOptions } from "../WorkflowContext.js"
import type * as Workflow from "../Workflow.js"
import { AdapterSupervisor } from "./AdapterSupervisor.js"
import * as DefinitionRegistry from "./DefinitionRegistry.js"
import * as DurableOutcome from "./DurableOutcome.js"
import * as DurableRejection from "./DurableRejection.js"
import * as GatedNetwork from "./GatedNetwork.js"
import { decodeDurableValue, encodeWorkflowInput, encodeWorkflowPayload } from "./SchemaBoundary.js"
import * as SdkError from "./SdkError.js"
import * as StepAdapter from "./StepAdapter.js"
import * as WorkflowAdapter from "./WorkflowAdapter.js"

const sdkCodec = new Codec()

const sdkOptions = (
  resonate: Resonate,
  version: number,
  options: InvocationOptions | undefined
) => resonate.options({
  version,
  ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
  ...(options?.target === undefined ? {} : { target: options.target }),
  ...(options?.tags === undefined ? {} : { tags: { ...options.tags } }),
  ...(options?.retry === undefined ? {} : {
    retryPolicy: Match.valueTags(options.retry, {
      Never: () => new Never(),
      Constant: ({ delay, maxRetries }) => new Constant({ delay, maxRetries }),
      Linear: ({ delay, maxRetries }) => new Linear({ delay, maxRetries }),
      Exponential: ({ delay, factor, maxRetries, maxDelay }) =>
        new Exponential({ delay, factor, maxRetries, maxDelay })
    })
  })
})

const stop = (resonate: Resonate): Effect.Effect<void> => Effect.tryPromise({
  try: () => resonate.stop(),
  catch: (cause) => cause
}).pipe(Effect.catch(() => Effect.logWarning("Resonate SDK shutdown failed")))

const release = (
  resonate: Resonate,
  gated: GatedNetwork.GatedNetwork,
  drainTimeout: Duration.Duration
): Effect.Effect<void, never, AdapterSupervisor> => Effect.gen(function*() {
  gated.close()
  yield* AdapterSupervisor.close
  const drained = yield* AdapterSupervisor.drain.pipe(Effect.timeoutOption(drainTimeout))
  yield* Option.match(drained, {
    onNone: () => AdapterSupervisor.abandon.pipe(
      Effect.andThen(stop(resonate)),
      Effect.andThen(AdapterSupervisor.drain)
    ),
    onSome: () => stop(resonate)
  })
})

const resultError = (
  cause: unknown
): Effect.Effect<never, ExecutionRejected | ResonateSdkError> => Option.match(
  DurableRejection.decode(cause),
  {
    onSome: Effect.fail,
    onNone: () => Effect.fail(SdkError.fromCause({
      operation: "handle.result",
      cause,
      requestMayHaveCommitted: false
    }))
  }
)

const awaitWorkflow = <Definition extends Workflow.Any>(
  workflow: Definition,
  handle: ResonateHandle<unknown>
): Effect.Effect<Workflow.Workflow.Success<Definition>, InvocationError<Definition>> => Effect.tryPromise({
  try: () => handle.result(),
  catch: (cause) => cause
}).pipe(
  Effect.catch(resultError),
  Effect.flatMap((value) => Effect.fromResult(
    DurableOutcome.decodeWorkflowResult(workflow, handle.id, value)
  )),
  Effect.flatMap(Effect.fromResult)
)

const invoke = <Definition extends Workflow.Any>(
  resonate: Resonate,
  workflow: Definition,
  id: string,
  input: Workflow.Workflow.Input<Definition>,
  options: InvocationOptions | undefined
): Effect.Effect<Workflow.Workflow.Success<Definition>, InvocationError<Definition>> => Effect.fromResult(
  encodeWorkflowInput(
    workflow.input as Workflow.WorkflowCodec<Workflow.Workflow.Input<Definition>>,
    input,
    workflow.name,
    workflow.version
  )
).pipe(
  Effect.flatMap((encoded) => Effect.tryPromise({
    try: () => resonate.run<unknown>(
      id,
      workflow.name,
      encoded,
      sdkOptions(resonate, workflow.version, options)
    ),
    catch: (cause) => SdkError.fromCause({
      operation: "run",
      cause,
      requestMayHaveCommitted: true
    })
  }).pipe(Effect.flatMap((handle) => awaitWorkflow(workflow, handle))))
)

const attach = <Definition extends Workflow.Any>(
  resonate: Resonate,
  workflow: Definition,
  id: string
): Effect.Effect<Workflow.Workflow.Success<Definition>, InvocationError<Definition>> => Effect.tryPromise({
  try: () => resonate.get<unknown>(id),
  catch: (cause) => SdkError.fromCause({
    operation: "get",
    cause,
    requestMayHaveCommitted: false
  })
}).pipe(Effect.flatMap((handle) => awaitWorkflow(workflow, handle)))

const settle = (
  operation: "promises.reject" | "promises.cancel",
  resonate: Resonate,
  id: string,
  reason: DurableValue | undefined
): Effect.Effect<void, InvalidDurableValue | ResonateSdkError> => {
  const validated = reason === undefined
    ? Result.succeed(undefined)
    : decodeDurableValue(reason, operation === "promises.reject" ? "PromiseRejection" : "PromiseCancellation")
  return Effect.fromResult(validated).pipe(
    Effect.flatMap((value) => Effect.tryPromise({
      try: () => operation === "promises.reject"
        ? resonate.promises.reject(id, sdkCodec.encode(value))
        : resonate.promises.cancel(id, sdkCodec.encode(value)),
      catch: (cause) => SdkError.fromCause({
        operation,
        cause,
        requestMayHaveCommitted: true
      })
    }).pipe(Effect.asVoid))
  )
}

const resolvePromise = <Value, Encoded extends DurableValue>(
  resonate: Resonate,
  id: string,
  schema: Schema.Codec<Value, Encoded, never, never>,
  value: Value
): Effect.Effect<void, DurableProtocolError | ResonateSdkError> => Effect.fromResult(
  encodeWorkflowPayload(schema, value)
).pipe(
  Effect.flatMap((encoded) => Effect.tryPromise({
    try: () => resonate.promises.resolve(id, sdkCodec.encode(encoded)),
    catch: (cause) => SdkError.fromCause({
      operation: "promises.resolve",
      cause,
      requestMayHaveCommitted: true
    })
  }).pipe(Effect.asVoid))
)

const register = <Group extends ResonateFunctions.Any>(
  resonate: Resonate,
  definitions: ReadonlyArray<DefinitionRegistry.Definition>,
  services: Context.Context<ResonateFunctions.Handlers<Group> | AdapterSupervisor>
): Effect.Effect<void, ResonateSdkError> => Effect.try({
  try: () => {
    const runWithServices = Effect.runPromiseWith(services)
    const runPromise = <A>(
      effect: Effect.Effect<A, never, Step.Handler<Step.Any> | AdapterSupervisor>
    ): Promise<A> => runWithServices(
      effect as Effect.Effect<A, never, ResonateFunctions.Handlers<Group> | AdapterSupervisor>
    )
    for (const definition of definitions) {
      Match.value(definition).pipe(
        Match.discriminators("kind")({
          Step: (step) => {
            resonate.register(step.name, StepAdapter.make(step, runPromise), { version: step.version })
          },
          Workflow: (workflow) => {
            const workflowServices = services as Context.Context<Workflow.Handler<Workflow.Any>>
            const handler = Context.get(
              workflowServices,
              workflow.handler as Context.Key<
                Workflow.Handler<Workflow.Any>,
                Workflow.HandlerService<unknown, unknown, unknown>
              >
            )
            resonate.register(workflow.name, WorkflowAdapter.make(
              workflow,
              handler as unknown as Workflow.HandlerService<never, never, never>
            ), {
              version: workflow.version
            })
          }
        }),
        Match.exhaustive
      )
    }
  },
  catch: (cause) => SdkError.fromCause({
    operation: "register",
    cause,
    requestMayHaveCommitted: false
  })
})

export const make = <Group extends ResonateFunctions.Any>(
  group: Group,
  options: LayerOptions<Group>
): Effect.Effect<
  ResonateClientService,
  | DefinitionRegistry.Error
  | InvalidClientConfiguration
  | ResonateSdkError,
  ResonateNetwork | ResonateFunctions.Handlers<Group> | AdapterSupervisor | Scope.Scope
> => Effect.gen(function*() {
  const registry = yield* DefinitionRegistry.make(group)
  const parsedDrainTimeout = Duration.fromInput(options.drainTimeout).pipe(
    Option.filter((duration) => Duration.isFinite(duration) && Duration.toMillis(duration) >= 0),
    Option.filter(() => typeof options.drainTimeout !== "number" || Number.isFinite(options.drainTimeout))
  )
  if (Option.isNone(parsedDrainTimeout)) {
    return yield* new InvalidClientConfiguration({ issue: "DrainTimeoutNotFinite" })
  }
  const drainTimeout = parsedDrainTimeout.value

  const provider = yield* ResonateNetwork
  const network = yield* provider.make
  const gated = GatedNetwork.make(network)
  let sdkOwnsNetwork = false
  yield* Effect.addFinalizer(() => sdkOwnsNetwork
    ? Effect.void
    : Effect.promise(() => gated.stop()).pipe(
      Effect.catch(() => Effect.logWarning("Resonate network shutdown failed"))
    ))

  const services = yield* Effect.context<ResonateFunctions.Handlers<Group> | AdapterSupervisor>()
  const resonate = yield* Effect.try({
    try: () => new Resonate({ network: gated }),
    catch: (cause) => SdkError.fromCause({
      operation: "network.init",
      cause,
      requestMayHaveCommitted: false
    })
  })
  yield* Effect.addFinalizer(() => release(resonate, gated, drainTimeout).pipe(
    Effect.provide(services)
  ))
  sdkOwnsNetwork = true

  yield* register(resonate, registry.definitions, services)
  yield* Effect.tryPromise({
    try: () => gated.initialized(),
    catch: (cause) => SdkError.fromCause({
      operation: "network.init",
      cause,
      requestMayHaveCommitted: false
    })
  })
  gated.open()

  return {
    run: ({ workflow, id, input, options: invocationOptions }) =>
      invoke(resonate, workflow, id, input, invocationOptions),
    attach: ({ workflow, id }) => attach(resonate, workflow, id),
    resolvePromise: ({ id, schema, value }) => resolvePromise(resonate, id, schema, value),
    rejectPromise: ({ id, reason }) => settle("promises.reject", resonate, id, reason),
    cancelPromise: ({ id, reason }) => settle("promises.cancel", resonate, id, reason)
  }
})
