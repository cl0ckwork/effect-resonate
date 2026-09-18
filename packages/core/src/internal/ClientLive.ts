import { Codec } from "@resonatehq/sdk"
import {
  Resonate,
  type AnyFunc,
  type ResonateHandle as SdkResonateHandle,
  type ResonateSchedule as SdkResonateSchedule
} from "@resonatehq/sdk/async"
import { Context, Duration, Effect, Match, Option, type Scope } from "effect"
import {
  type ExecutionRejected,
  InvalidClientConfiguration,
  type ResonateSdkError
} from "../CoreExecutionError.js"
import type {
  GetRequest,
  InvocationRequest,
  LayerOptions,
  Options,
  OptionsInput,
  PromiseCreateRequest,
  PromiseCreateWithTaskRequest,
  PromiseGetRequest,
  PromiseRegisterCallbackRequest,
  PromiseRegisterListenerRequest,
  RawInvocationRequest,
  RawPromiseSettleRequest,
  RegisterRequest,
  ResonateClientService,
  ResonateFunc,
  ResonateHandle,
  ResonateSchedule,
  ScheduleCreateRequest,
  ScheduleDeleteRequest,
  ScheduleGetRequest,
  ScheduleRequest,
  SetDependencyRequest,
  TypedGetRequest,
  TypedInvocationRequest,
  TypedPromiseSettleRequest,
  TypedResultError
} from "../ResonateClient.js"
import type * as ResonateFunctions from "../ResonateFunctions.js"
import { ResonateNetwork } from "../ResonateNetwork.js"
import type * as Step from "../Step.js"
import type * as Workflow from "../Workflow.js"
import { AdapterSupervisor } from "./AdapterSupervisor.js"
import * as DefinitionRegistry from "./DefinitionRegistry.js"
import * as DurableOutcome from "./DurableOutcome.js"
import * as DurableRejection from "./DurableRejection.js"
import * as GatedNetwork from "./GatedNetwork.js"
import { encodeWorkflowInput, encodeWorkflowPayload } from "./SchemaBoundary.js"
import * as SdkError from "./SdkError.js"
import * as StepAdapter from "./StepAdapter.js"
import * as WorkflowAdapter from "./WorkflowAdapter.js"

type Operation = ResonateSdkError["operation"]

const sdkEffect = <Value>(
  operation: Operation,
  requestMayHaveCommitted: boolean,
  evaluate: () => Promise<Value>
): Effect.Effect<Value, ResonateSdkError> => Effect.tryPromise({
  try: evaluate,
  catch: (cause) => SdkError.fromCause({ operation, cause, requestMayHaveCommitted })
})

const sdkSync = <Value>(
  operation: Operation,
  requestMayHaveCommitted: boolean,
  evaluate: () => Value
): Effect.Effect<Value, ResonateSdkError> => Effect.try({
  try: evaluate,
  catch: (cause) => SdkError.fromCause({ operation, cause, requestMayHaveCommitted })
})

const rawHandle = <Value>(handle: SdkResonateHandle<Value>): ResonateHandle<Value> => ({
  id: handle.id,
  result: () => sdkEffect("handle.result", true, () => handle.result()),
  done: () => sdkEffect("handle.done", true, () => handle.done())
})

const typedHandle = <Definition extends Workflow.Any>(
  workflow: Definition,
  handle: SdkResonateHandle<unknown>
): ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>> => {
  const result = (): Effect.Effect<
    Workflow.Workflow.Success<Definition>,
    TypedResultError<Definition>
  > => sdkEffect("handle.result", true, () => handle.result()).pipe(
    Effect.catch((error): Effect.Effect<never, ExecutionRejected | ResonateSdkError> => {
      const rejection = DurableRejection.decode(error.cause)
      return Option.isSome(rejection) ? Effect.fail(rejection.value) : Effect.fail(error)
    }),
    Effect.flatMap((value) => Effect.fromResult(
      DurableOutcome.decodeWorkflowResult(workflow, handle.id, value)
    )),
    Effect.flatMap((result) => Effect.fromResult(result))
  )
  return {
    id: handle.id,
    result,
    done: () => sdkEffect("handle.done", true, () => handle.done())
  }
}

const scheduleHandle = (handle: SdkResonateSchedule): ResonateSchedule => ({
  delete: () => sdkEffect("schedule.delete", true, () => handle.delete())
})

const withOptions = (
  args: ReadonlyArray<unknown> | undefined,
  options: Options | undefined
): ReadonlyArray<unknown> => options === undefined ? args ?? [] : [...args ?? [], options]

const invokeRaw = (
  operation: "run" | "rpc",
  resonate: Resonate,
  request: RawInvocationRequest<AnyFunc | string>
): Effect.Effect<ResonateHandle<unknown>, ResonateSdkError> => sdkEffect(
  operation,
  true,
  () => resonate[operation]<unknown>(
    request.id,
    request.func,
    ...withOptions(request.args, request.options)
  )
).pipe(Effect.map(rawHandle))

const invokeTyped = <Definition extends Workflow.Any>(
  operation: "run" | "rpc",
  resonate: Resonate,
  request: TypedInvocationRequest<Definition>
) => Effect.fromResult(encodeWorkflowInput(
  request.workflow.input as Workflow.WorkflowCodec<Workflow.Workflow.Input<Definition>>,
  request.input,
  request.workflow.name,
  request.workflow.version
)).pipe(
  Effect.flatMap((input) => sdkEffect(
    operation,
    true,
    () => resonate[operation]<unknown>(
      request.id,
      request.workflow.name,
      input,
      resonate.options({ ...request.options, version: request.workflow.version })
    )
  )),
  Effect.map((handle) => typedHandle(request.workflow, handle))
)

const get = (
  resonate: Resonate,
  request: GetRequest | TypedGetRequest<Workflow.Any>
): Effect.Effect<ResonateHandle<unknown, unknown>, ResonateSdkError> => sdkEffect(
  "get",
  false,
  () => resonate.get(request.id)
).pipe(Effect.map((handle) => "workflow" in request
  ? typedHandle(request.workflow, handle)
  : rawHandle(handle)))

const registeredFunction = <Func extends AnyFunc>(
  resonate: Resonate,
  registered: ReturnType<Resonate["register"]>
): ResonateFunc<Func> => ({
  run: (request) => sdkEffect(
    "run",
    true,
    () => registered.run(request.id, ...withOptions(request.args, request.options))
  ).pipe(Effect.map(rawHandle)) as ReturnType<ResonateFunc<Func>["run"]>,
  rpc: (request) => sdkEffect(
    "rpc",
    true,
    () => registered.rpc(request.id, ...withOptions(request.args, request.options))
  ).pipe(Effect.map(rawHandle)) as ReturnType<ResonateFunc<Func>["rpc"]>,
  // The SDK 0.11.5 function helper exposes this method unbound. Use the owning
  // client builder so the documented operation works without changing its data.
  options: (request?: OptionsInput) => sdkSync("options", false, () => resonate.options(request))
})

const registerRaw = <Func extends AnyFunc>(
  resonate: Resonate,
  request: RegisterRequest<Func>
): Effect.Effect<ResonateFunc<Func>, ResonateSdkError> => sdkSync(
  "register",
  false,
  () => {
    const registered = "name" in request
      ? resonate.register(request.name, request.func, request.options)
      : resonate.register(request.func, request.options)
    return registeredFunction<Func>(resonate, registered)
  }
)

const registerDefinitions = <Group extends ResonateFunctions.Any>(
  resonate: Resonate,
  definitions: ReadonlyArray<DefinitionRegistry.Definition>,
  services: Context.Context<ResonateFunctions.Handlers<Group> | AdapterSupervisor>
): Effect.Effect<void, ResonateSdkError> => sdkSync("register", false, () => {
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
          ), { version: workflow.version })
        }
      }),
      Match.exhaustive
    )
  }
})

const stopSdk = (resonate: Resonate): Effect.Effect<void, ResonateSdkError> =>
  sdkEffect("stop", false, () => resonate.stop())

const release = (
  resonate: Resonate,
  gated: GatedNetwork.GatedNetwork,
  drainTimeout: Duration.Duration
): Effect.Effect<void, ResonateSdkError, AdapterSupervisor> => Effect.gen(function*() {
  gated.close()
  yield* AdapterSupervisor.close
  const drained = yield* AdapterSupervisor.drain.pipe(Effect.timeoutOption(drainTimeout))
  yield* Option.match(drained, {
    onNone: () => AdapterSupervisor.abandon.pipe(
      Effect.andThen(stopSdk(resonate)),
      Effect.ensuring(AdapterSupervisor.drain)
    ),
    onSome: () => stopSdk(resonate)
  })
})

const settleTyped = <Value>(
  operation: "promises.resolve" | "promises.reject" | "promises.cancel",
  resonate: Resonate,
  codec: Codec,
  request: TypedPromiseSettleRequest<Value, never>
) => Effect.fromResult(encodeWorkflowPayload(request.schema, request.value)).pipe(
  Effect.flatMap((encoded) => sdkEffect(
    operation,
    true,
    () => resonate.promises[operation.slice("promises.".length) as "resolve" | "reject" | "cancel"](
      request.id,
      codec.encode(encoded)
    )
  ))
)

export const make = <Group extends ResonateFunctions.Any>(
  group: Group | undefined,
  options: LayerOptions<Group>
): Effect.Effect<
  ResonateClientService,
  | DefinitionRegistry.Error
  | InvalidClientConfiguration
  | ResonateSdkError,
  ResonateNetwork | ResonateFunctions.Handlers<Group> | AdapterSupervisor | Scope.Scope
> => Effect.gen(function*() {
  const registry = group === undefined
    ? { definitions: [] as ReadonlyArray<DefinitionRegistry.Definition> }
    : yield* DefinitionRegistry.make(group)
  const parsedDrainTimeout = Duration.fromInput(options.drainTimeout).pipe(
    Option.filter((duration) => Duration.isFinite(duration) && Duration.toMillis(duration) >= 0),
    Option.filter(() => typeof options.drainTimeout !== "number" || Number.isFinite(options.drainTimeout))
  )
  if (Option.isNone(parsedDrainTimeout)) {
    return yield* new InvalidClientConfiguration({ issue: "DrainTimeoutNotFinite" })
  }

  const { drainTimeout: _drainTimeout, functions: _functions, ...clientOptions } = options
  const codec = new Codec(clientOptions.encryptor)
  const provider = yield* ResonateNetwork
  const network = yield* provider.make
  const gated = GatedNetwork.make(network)
  let sdkOwnsNetwork = false
  yield* Effect.addFinalizer(() => sdkOwnsNetwork
    ? Effect.void
    : Effect.promise(() => gated.stop()))

  const services = yield* Effect.context<ResonateFunctions.Handlers<Group> | AdapterSupervisor>()
  const resonate = yield* sdkSync("network.init", false, () => new Resonate({
    ...clientOptions,
    network: gated
  }))
  sdkOwnsNetwork = true

  const shutdown = yield* Effect.cached(
    release(resonate, gated, parsedDrainTimeout.value).pipe(Effect.provide(services))
  )
  yield* Effect.addFinalizer(() => shutdown.pipe(Effect.orDie))

  yield* registerDefinitions(resonate, registry.definitions, services)
  yield* sdkEffect("network.init", false, () => gated.initialized())
  gated.open()

  const promiseSettle = (
    operation: "resolve" | "reject" | "cancel",
    request: RawPromiseSettleRequest | TypedPromiseSettleRequest<unknown, never>
  ) => "schema" in request
    ? settleTyped(`promises.${operation}`, resonate, codec, request)
    : sdkEffect(`promises.${operation}`, true, () => resonate.promises[operation](request.id, request.options))

  return {
    register: (request) => registerRaw(resonate, request),
    setDependency: ({ name, value }: SetDependencyRequest) =>
      sdkSync("setDependency", false, () => resonate.setDependency(name, value)),
    run: (request: InvocationRequest) => "workflow" in request
      ? invokeTyped("run", resonate, request)
      : invokeRaw("run", resonate, request),
    rpc: (request: InvocationRequest) => "workflow" in request
      ? invokeTyped("rpc", resonate, request)
      : invokeRaw("rpc", resonate, request),
    get: (request: GetRequest | TypedGetRequest<Workflow.Any>) => get(resonate, request),
    schedule: (request: ScheduleRequest<AnyFunc | string>) => sdkEffect(
      "schedule",
      true,
      () => typeof request.func === "string"
        ? resonate.schedule(
          request.name,
          request.cron,
          request.func,
          ...withOptions(request.args, request.options)
        )
        : resonate.schedule(
          request.name,
          request.cron,
          request.func,
          ...withOptions(request.args, request.options)
        )
    ).pipe(Effect.map(scheduleHandle)),
    options: (request?: OptionsInput) => sdkSync("options", false, () => resonate.options(request)),
    promises: {
      get: ({ id }: PromiseGetRequest) => sdkEffect("promises.get", false, () => resonate.promises.get(id)),
      create: ({ id, timeoutAt, options: createOptions }: PromiseCreateRequest) =>
        sdkEffect("promises.create", true, () => resonate.promises.create(id, timeoutAt, createOptions)),
      createWithTask: ({ id, timeoutAt, pid, ttl, options: createOptions }: PromiseCreateWithTaskRequest) =>
        sdkEffect("promises.createWithTask", true, () =>
          resonate.promises.createWithTask(id, timeoutAt, pid, ttl, createOptions)),
      resolve: (request: RawPromiseSettleRequest | TypedPromiseSettleRequest<unknown, never>) =>
        promiseSettle("resolve", request),
      reject: (request: RawPromiseSettleRequest | TypedPromiseSettleRequest<unknown, never>) =>
        promiseSettle("reject", request),
      cancel: (request: RawPromiseSettleRequest | TypedPromiseSettleRequest<unknown, never>) =>
        promiseSettle("cancel", request),
      registerCallback: ({ awaited, awaiter }: PromiseRegisterCallbackRequest) =>
        sdkEffect("promises.registerCallback", true, () =>
          resonate.promises.registerCallback(awaited, awaiter)),
      registerListener: ({ awaited, address }: PromiseRegisterListenerRequest) =>
        sdkEffect("promises.registerListener", true, () =>
          resonate.promises.registerListener(awaited, address))
    },
    schedules: {
      get: ({ id }: ScheduleGetRequest) => sdkEffect("schedules.get", false, () => resonate.schedules.get(id)),
      create: ({ id, cron, promiseId, promiseTimeout, options: scheduleOptions }: ScheduleCreateRequest) =>
        sdkEffect("schedules.create", true, () =>
          resonate.schedules.create(id, cron, promiseId, promiseTimeout, scheduleOptions)),
      delete: ({ id }: ScheduleDeleteRequest) =>
        sdkEffect("schedules.delete", true, () => resonate.schedules.delete(id))
    },
    stop: () => shutdown
  } as ResonateClientService
})
