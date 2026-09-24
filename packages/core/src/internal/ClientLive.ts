import { Codec } from "@resonatehq/sdk"
import {
  Resonate,
  type AnyFunc,
  type ResonateHandle as SdkResonateHandle,
  type ResonateSchedule as SdkResonateSchedule
} from "@resonatehq/sdk/async"
import { Context, Duration, Effect, Fiber, Match, Option, Schema, type Scope } from "effect"
import {
  DefinitionConflict,
  DurableProtocolError,
  type ExecutionRejected,
  InvalidClientConfiguration,
  type ResonateSdkError
} from "../CoreExecutionError.js"
import type {
  LayerOptions,
  OptionsInput,
  PromisesService,
  RegisterOptions,
  ResonateClientService,
  ResonateFunc,
  ResonateHandle,
  ResonateSchedule,
  SchedulesService,
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
import * as NetworkGate from "./NetworkGate.js"
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
    Effect.catch((error): Effect.Effect<
      never,
      DefinitionConflict | DurableProtocolError | ExecutionRejected | ResonateSdkError
    > => {
      const rejection = DurableRejection.decode(error.cause)
      if (Option.isNone(rejection)) {
        return Effect.fail(error)
      }
      if (rejection.value.executionId !== handle.id) {
        return Effect.fail(new DurableProtocolError({ issue: "InvalidDefinitionIdentity" }))
      }
      if (
        rejection.value.definitionName !== workflow.name ||
        rejection.value.definitionVersion !== workflow.version
      ) {
        return Effect.fail(new DefinitionConflict({
          executionId: handle.id,
          expectedName: workflow.name,
          expectedVersion: workflow.version,
          actualName: rejection.value.definitionName,
          actualVersion: rejection.value.definitionVersion
        }))
      }
      return Effect.fail(rejection.value)
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

const invokeRaw = (
  operation: "run" | "rpc",
  resonate: Resonate,
  id: string,
  func: AnyFunc | string,
  args: ReadonlyArray<unknown>
): Effect.Effect<ResonateHandle<unknown>, ResonateSdkError> => sdkEffect(
  operation,
  true,
  () => resonate[operation]<unknown>(id, func, ...args)
).pipe(Effect.map(rawHandle))

const invokeTyped = <Definition extends Workflow.Any>(
  operation: "run" | "rpc",
  resonate: Resonate,
  id: string,
  workflow: Definition,
  inputValue: unknown,
  options: OptionsInput
) => Effect.fromResult(encodeWorkflowInput(
  workflow.input as Workflow.WorkflowCodec<unknown>,
  inputValue,
  workflow.name,
  workflow.version
)).pipe(
  Effect.flatMap((input) => sdkEffect(
    operation,
    true,
    () => resonate[operation]<unknown>(
      id,
      workflow.name,
      input,
      resonate.options({ ...options, version: workflow.version })
    )
  )),
  Effect.map((handle) => typedHandle(workflow, handle))
)

const get = (
  resonate: Resonate,
  id: string,
  workflow: Workflow.Any | undefined
): Effect.Effect<ResonateHandle<unknown, unknown>, ResonateSdkError> => sdkEffect(
  "get",
  false,
  () => resonate.get(id)
).pipe(Effect.map((handle) => workflow === undefined
  ? rawHandle(handle)
  : typedHandle(workflow, handle)))

const registeredFunction = <Func extends AnyFunc>(
  resonate: Resonate,
  registered: ReturnType<Resonate["register"]>
): ResonateFunc<Func> => ({
  run: (...args) => sdkEffect(
    "run",
    true,
    () => registered.run(...args)
  ).pipe(Effect.map(rawHandle)) as ReturnType<ResonateFunc<Func>["run"]>,
  rpc: (...args) => sdkEffect(
    "rpc",
    true,
    () => registered.rpc(...args)
  ).pipe(Effect.map(rawHandle)) as ReturnType<ResonateFunc<Func>["rpc"]>,
  // The SDK 0.11.5 function helper exposes this method unbound. Use the owning
  // client builder so the documented operation works without changing its data.
  options: (request) => sdkSync("options", false, () => resonate.options(request as OptionsInput))
})

const registerRaw = <Func extends AnyFunc>(
  resonate: Resonate,
  nameOrFunc: string | Func,
  funcOrOptions: Func | RegisterOptions | undefined,
  options: RegisterOptions | undefined
): Effect.Effect<ResonateFunc<Func>, ResonateSdkError> => sdkSync(
  "register",
  false,
  () => {
    const registered = typeof nameOrFunc === "string"
      ? resonate.register(nameOrFunc, funcOrOptions as Func, options)
      : resonate.register(nameOrFunc, funcOrOptions as RegisterOptions)
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
  gate: NetworkGate.NetworkGate,
  drainTimeout: Duration.Duration
): Effect.Effect<void, ResonateSdkError, AdapterSupervisor> => Effect.gen(function*() {
  gate.close()
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
  id: string,
  schema: Workflow.WorkflowCodec<Value>,
  value: Value
) => Effect.fromResult(encodeWorkflowPayload(schema, value)).pipe(
  Effect.flatMap((encoded) => sdkEffect(
    operation,
    true,
    () => resonate.promises[operation.slice("promises.".length) as "resolve" | "reject" | "cancel"](
      id,
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
  const gate = NetworkGate.make(network)
  let sdkOwnsNetwork = false
  yield* Effect.addFinalizer(() => sdkOwnsNetwork
    ? Effect.void
    : Effect.promise(() => gate.stop()))

  const services = yield* Effect.context<ResonateFunctions.Handlers<Group> | AdapterSupervisor>()
  const resonate = yield* sdkSync("network.init", false, () => new Resonate({
    ...clientOptions,
    network: gate
  }))
  sdkOwnsNetwork = true

  const shutdownOwner = yield* Effect.cached(
    release(resonate, gate, parsedDrainTimeout.value).pipe(
      Effect.provide(services),
      Effect.forkDetach,
      Effect.uninterruptible
    )
  )
  const shutdown = shutdownOwner.pipe(Effect.flatMap(Fiber.join))
  yield* Effect.addFinalizer(() => shutdown.pipe(Effect.orDie))

  yield* registerDefinitions(resonate, registry.definitions, services)
  yield* sdkEffect("network.init", false, () => gate.initialized())
  gate.open()

  const promiseSettle = (
    operation: "resolve" | "reject" | "cancel",
    args: ReadonlyArray<unknown>
  ) => Schema.isSchema(args[1])
    ? settleTyped(
      `promises.${operation}`,
      resonate,
      codec,
      args[0] as string,
      args[1] as Workflow.WorkflowCodec<unknown>,
      args[2]
    )
    : sdkEffect(`promises.${operation}`, true, () => (
      resonate.promises[operation] as (...values: ReadonlyArray<unknown>) => Promise<unknown>
    )(...args))

  const promises = {
    get: (...args: Parameters<typeof resonate.promises.get>) =>
      sdkEffect("promises.get", false, () => resonate.promises.get(...args)),
    create: (...args: Parameters<typeof resonate.promises.create>) =>
      sdkEffect("promises.create", true, () => resonate.promises.create(...args)),
    createWithTask: (...args: Parameters<typeof resonate.promises.createWithTask>) =>
      sdkEffect("promises.createWithTask", true, () => resonate.promises.createWithTask(...args)),
    resolve: ((...args: ReadonlyArray<unknown>) => promiseSettle("resolve", args)) as PromisesService["resolve"],
    reject: ((...args: ReadonlyArray<unknown>) => promiseSettle("reject", args)) as PromisesService["reject"],
    cancel: ((...args: ReadonlyArray<unknown>) => promiseSettle("cancel", args)) as PromisesService["cancel"],
    registerCallback: (...args: Parameters<typeof resonate.promises.registerCallback>) =>
      sdkEffect("promises.registerCallback", true, () => resonate.promises.registerCallback(...args)),
    registerListener: (...args: Parameters<typeof resonate.promises.registerListener>) =>
      sdkEffect("promises.registerListener", true, () => resonate.promises.registerListener(...args))
  } satisfies PromisesService

  const schedules = {
    get: (...args: Parameters<typeof resonate.schedules.get>) =>
      sdkEffect("schedules.get", false, () => resonate.schedules.get(...args)),
    create: (...args: Parameters<typeof resonate.schedules.create>) =>
      sdkEffect("schedules.create", true, () => resonate.schedules.create(...args)),
    delete: (...args: Parameters<typeof resonate.schedules.delete>) =>
      sdkEffect("schedules.delete", true, () => resonate.schedules.delete(...args))
  } satisfies SchedulesService

  const register = ((
    nameOrFunc: string | AnyFunc,
    funcOrOptions?: AnyFunc | RegisterOptions,
    registerOptions?: RegisterOptions
  ) => registerRaw(resonate, nameOrFunc, funcOrOptions, registerOptions)) as ResonateClientService["register"]
  const run = ((id: string, func: Workflow.Any | AnyFunc | string, ...args: ReadonlyArray<unknown>) =>
    typeof func === "object"
      ? invokeTyped("run", resonate, id, func, args[0], args[1] as OptionsInput)
      : invokeRaw("run", resonate, id, func, args)) as ResonateClientService["run"]
  const rpc = ((id: string, func: Workflow.Any | AnyFunc | string, ...args: ReadonlyArray<unknown>) =>
    typeof func === "object"
      ? invokeTyped("rpc", resonate, id, func, args[0], args[1] as OptionsInput)
      : invokeRaw("rpc", resonate, id, func, args)) as ResonateClientService["rpc"]
  const getHandle = ((id: string, workflow?: Workflow.Any) =>
    get(resonate, id, workflow)) as ResonateClientService["get"]

  const service = {
    register,
    setDependency: (name: string, value: unknown) =>
      sdkSync("setDependency", false, () => resonate.setDependency(name, value)),
    run,
    rpc,
    get: getHandle,
    schedule: (name: string, cron: string, func: AnyFunc | string, ...args: ReadonlyArray<unknown>) => sdkEffect(
      "schedule",
      true,
      () => resonate.schedule(name, cron, func as AnyFunc, ...args)
    ).pipe(Effect.map(scheduleHandle)),
    options: (request?: OptionsInput) => sdkSync("options", false, () => resonate.options(request)),
    promises,
    schedules,
    stop: () => shutdown
  } satisfies ResonateClientService

  return service
})
