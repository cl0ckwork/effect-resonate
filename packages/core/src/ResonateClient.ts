import type { AnyFunc, Resonate as SdkResonate, ResonateFunc as SdkResonateFunc } from "@resonatehq/sdk/async"
import { Context, type Duration, Effect, Layer, type Schema } from "effect"
import type {
  DefinitionConflict,
  DurableProtocolError,
  DuplicateDefinition,
  ExecutionRejected,
  InvalidClientConfiguration,
  InvalidDefinition,
  InvalidWorkflowInput,
  ResonateSdkError
} from "./CoreExecutionError.js"
import type { Type as DurableValue } from "./DurableValue.js"
import type * as ResonateFunctions from "./ResonateFunctions.js"
import { ResonateNetwork } from "./ResonateNetwork.js"
import type * as Workflow from "./Workflow.js"
import { AdapterSupervisor } from "./internal/AdapterSupervisor.js"
import * as ClientLive from "./internal/ClientLive.js"

type MethodParameters<Method> = Method extends (...args: infer Parameters) => unknown ? Parameters : never
type FunctionReturn<Func extends AnyFunc> = Func extends (...args: infer _Arguments) => infer Return
  ? Awaited<Return>
  : never
type SdkPromises = SdkResonate["promises"]
type SdkSchedules = SdkResonate["schedules"]
type SdkRunParameters = MethodParameters<SdkResonate["run"]>
type SdkRpcParameters = MethodParameters<SdkResonate["rpc"]>
type SdkScheduleParameters = MethodParameters<SdkResonate["schedule"]>
type RegisteredRunParameters<Func extends AnyFunc> = MethodParameters<SdkResonateFunc<Func>["run"]>
type RegisteredRpcParameters<Func extends AnyFunc> = MethodParameters<SdkResonateFunc<Func>["rpc"]>
type FunctionRunParameters<Func extends AnyFunc> = RegisteredRunParameters<Func> extends [
  id: string,
  ...args: infer Arguments
] ? Arguments : never
type FunctionRpcParameters<Func extends AnyFunc> = RegisteredRpcParameters<Func> extends [
  id: string,
  ...args: infer Arguments
] ? Arguments : never
type SdkClientOptions = NonNullable<ConstructorParameters<typeof SdkResonate>[0]>

/** All async SDK constructor options except the Layer-owned network instance. */
export type ClientOptions = Omit<SdkClientOptions, "network">
/** The concrete options object built by the installed async SDK. */
export type Options = ReturnType<SdkResonate["options"]>
/** The fields accepted by the installed async SDK's options builder. */
export type OptionsInput = MethodParameters<SdkResonate["options"]>[0]
/** Root invocation options accepted by the installed async client, with the definition supplying `version`. */
export type ClientInvocationOptions = Omit<NonNullable<OptionsInput>, "version">
export type RegisterOptions = MethodParameters<SdkResonate["register"]>[1]

export type TypedResultError<Definition extends Workflow.Any> =
  | Workflow.Workflow.Failure<Definition>
  | DefinitionConflict
  | DurableProtocolError
  | ExecutionRejected
  | InvalidWorkflowInput
  | ResonateSdkError
export type InvocationError<Definition extends Workflow.Any> = TypedResultError<Definition>

/** An async-SDK handle whose wait boundaries remain explicit Effects. */
export interface ResonateHandle<Success, ResultError = ResonateSdkError> {
  readonly id: string
  readonly result: () => Effect.Effect<Success, ResultError>
  readonly done: () => Effect.Effect<boolean, ResonateSdkError>
}

/** The handle returned by the async SDK's top-level schedule helper. */
export interface ResonateSchedule {
  readonly delete: () => Effect.Effect<void, ResonateSdkError>
}

/** The function-scoped client returned by `register`. */
export interface ResonateFunc<Func extends AnyFunc> {
  readonly run: (...args: RegisteredRunParameters<Func>) =>
    Effect.Effect<ResonateHandle<FunctionReturn<Func>>, ResonateSdkError>
  readonly rpc: (...args: RegisteredRpcParameters<Func>) =>
    Effect.Effect<ResonateHandle<FunctionReturn<Func>>, ResonateSdkError>
  /** Bound to the owning client, correcting the unbound SDK 0.11.5 helper. */
  readonly options: (...args: MethodParameters<SdkResonateFunc<Func>["options"]>) =>
    Effect.Effect<ReturnType<SdkResonateFunc<Func>["options"]>, ResonateSdkError>
}

type PromiseGetParameters = MethodParameters<SdkPromises["get"]>
type PromiseCreateParameters = MethodParameters<SdkPromises["create"]>
type PromiseCreateWithTaskParameters = MethodParameters<SdkPromises["createWithTask"]>
type PromiseResolveParameters = MethodParameters<SdkPromises["resolve"]>
type PromiseRejectParameters = MethodParameters<SdkPromises["reject"]>
type PromiseCancelParameters = MethodParameters<SdkPromises["cancel"]>
type PromiseRegisterCallbackParameters = MethodParameters<SdkPromises["registerCallback"]>
type PromiseRegisterListenerParameters = MethodParameters<SdkPromises["registerListener"]>
type PromiseGetResult = Awaited<ReturnType<SdkPromises["get"]>>
type PromiseCreateResult = Awaited<ReturnType<SdkPromises["create"]>>
type PromiseCreateWithTaskResult = Awaited<ReturnType<SdkPromises["createWithTask"]>>
type PromiseResolveResult = Awaited<ReturnType<SdkPromises["resolve"]>>
type PromiseRejectResult = Awaited<ReturnType<SdkPromises["reject"]>>
type PromiseCancelResult = Awaited<ReturnType<SdkPromises["cancel"]>>
type PromiseRegisterCallbackResult = Awaited<ReturnType<SdkPromises["registerCallback"]>>
type PromiseRegisterListenerResult = Awaited<ReturnType<SdkPromises["registerListener"]>>

export interface PromisesService {
  readonly get: (...args: PromiseGetParameters) => Effect.Effect<
    Awaited<ReturnType<SdkPromises["get"]>>,
    ResonateSdkError
  >
  readonly create: (...args: PromiseCreateParameters) => Effect.Effect<
    Awaited<ReturnType<SdkPromises["create"]>>,
    ResonateSdkError
  >
  readonly createWithTask: (...args: PromiseCreateWithTaskParameters) => Effect.Effect<
    Awaited<ReturnType<SdkPromises["createWithTask"]>>,
    ResonateSdkError
  >
  readonly resolve: {
    (...args: PromiseResolveParameters): Effect.Effect<Awaited<ReturnType<SdkPromises["resolve"]>>, ResonateSdkError>
    <Value, Encoded extends DurableValue>(
      id: string,
      schema: Schema.Codec<Value, Encoded, never, never>,
      value: Value
    ): Effect.Effect<Awaited<ReturnType<SdkPromises["resolve"]>>, DurableProtocolError | ResonateSdkError>
  }
  readonly reject: {
    (...args: PromiseRejectParameters): Effect.Effect<Awaited<ReturnType<SdkPromises["reject"]>>, ResonateSdkError>
    <Value, Encoded extends DurableValue>(
      id: string,
      schema: Schema.Codec<Value, Encoded, never, never>,
      value: Value
    ): Effect.Effect<Awaited<ReturnType<SdkPromises["reject"]>>, DurableProtocolError | ResonateSdkError>
  }
  readonly cancel: {
    (...args: PromiseCancelParameters): Effect.Effect<Awaited<ReturnType<SdkPromises["cancel"]>>, ResonateSdkError>
    <Value, Encoded extends DurableValue>(
      id: string,
      schema: Schema.Codec<Value, Encoded, never, never>,
      value: Value
    ): Effect.Effect<Awaited<ReturnType<SdkPromises["cancel"]>>, DurableProtocolError | ResonateSdkError>
  }
  readonly registerCallback: (...args: PromiseRegisterCallbackParameters) => Effect.Effect<
    Awaited<ReturnType<SdkPromises["registerCallback"]>>,
    ResonateSdkError
  >
  readonly registerListener: (...args: PromiseRegisterListenerParameters) => Effect.Effect<
    Awaited<ReturnType<SdkPromises["registerListener"]>>,
    ResonateSdkError
  >
}

type ScheduleGetParameters = MethodParameters<SdkSchedules["get"]>
type ScheduleCreateParameters = MethodParameters<SdkSchedules["create"]>
type ScheduleDeleteParameters = MethodParameters<SdkSchedules["delete"]>
type ScheduleGetResult = Awaited<ReturnType<SdkSchedules["get"]>>
type ScheduleCreateResult = Awaited<ReturnType<SdkSchedules["create"]>>
type ScheduleDeleteResult = Awaited<ReturnType<SdkSchedules["delete"]>>

export interface SchedulesService {
  readonly get: (...args: ScheduleGetParameters) => Effect.Effect<
    Awaited<ReturnType<SdkSchedules["get"]>>,
    ResonateSdkError
  >
  readonly create: (...args: ScheduleCreateParameters) => Effect.Effect<
    Awaited<ReturnType<SdkSchedules["create"]>>,
    ResonateSdkError
  >
  readonly delete: (...args: ScheduleDeleteParameters) => Effect.Effect<
    Awaited<ReturnType<SdkSchedules["delete"]>>,
    ResonateSdkError
  >
}

export interface ResonateClientService {
  readonly register: {
    <Func extends AnyFunc>(name: string, func: Func, options?: RegisterOptions):
      Effect.Effect<ResonateFunc<Func>, ResonateSdkError>
    <Func extends AnyFunc>(func: Func, options?: RegisterOptions):
      Effect.Effect<ResonateFunc<Func>, ResonateSdkError>
  }
  readonly setDependency: <Value>(name: string, value: Value) => Effect.Effect<void, ResonateSdkError>
  readonly run: {
    <Definition extends Workflow.Any>(
      id: string,
      workflow: Definition,
      input: Workflow.Workflow.Input<Definition>,
      options?: ClientInvocationOptions
    ): Effect.Effect<
      ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
      InvalidWorkflowInput | ResonateSdkError
    >
    <Func extends AnyFunc>(id: string, func: Func, ...args: FunctionRunParameters<Func>): Effect.Effect<
      ResonateHandle<FunctionReturn<Func>>,
      ResonateSdkError
    >
    <Success = unknown>(...args: SdkRunParameters): Effect.Effect<
      ResonateHandle<Success>,
      ResonateSdkError
    >
  }
  readonly rpc: {
    <Definition extends Workflow.Any>(
      id: string,
      workflow: Definition,
      input: Workflow.Workflow.Input<Definition>,
      options?: ClientInvocationOptions
    ): Effect.Effect<
      ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
      InvalidWorkflowInput | ResonateSdkError
    >
    <Func extends AnyFunc>(id: string, func: Func, ...args: FunctionRpcParameters<Func>): Effect.Effect<
      ResonateHandle<FunctionReturn<Func>>,
      ResonateSdkError
    >
    <Success = unknown>(...args: SdkRpcParameters): Effect.Effect<
      ResonateHandle<Success>,
      ResonateSdkError
    >
  }
  readonly get: {
    <Definition extends Workflow.Any>(id: string, workflow: Definition): Effect.Effect<
      ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
      ResonateSdkError
    >
    <Success = unknown>(id: string): Effect.Effect<ResonateHandle<Success>, ResonateSdkError>
  }
  readonly schedule: {
    <Func extends AnyFunc>(
      name: string,
      cron: string,
      func: Func,
      ...args: FunctionRunParameters<Func>
    ): Effect.Effect<ResonateSchedule, ResonateSdkError>
    (...args: SdkScheduleParameters): Effect.Effect<ResonateSchedule, ResonateSdkError>
  }
  readonly options: (options?: OptionsInput) => Effect.Effect<Options, ResonateSdkError>
  readonly promises: PromisesService
  readonly schedules: SchedulesService
  readonly stop: () => Effect.Effect<void, ResonateSdkError>
}

export interface LayerOptions<Group extends ResonateFunctions.Any | undefined = undefined> extends ClientOptions {
  readonly functions?: Group
  readonly drainTimeout: Duration.Input
}

/** Effect-facing access to the installed async Resonate client. */
export class ResonateClient extends Context.Service<ResonateClient, ResonateClientService>()(
  "@effect-resonate/core/ResonateClient"
) {}

type AccessorEffect<Success, Error> = Effect.Effect<Success, Error, ResonateClient>
const use = <Success, Error>(
  operation: (client: ResonateClientService) => Effect.Effect<Success, Error>
): AccessorEffect<Success, Error> => ResonateClient.use(operation)

export function register<Func extends AnyFunc>(
  name: string,
  func: Func,
  options?: RegisterOptions
): AccessorEffect<ResonateFunc<Func>, ResonateSdkError>
export function register<Func extends AnyFunc>(
  func: Func,
  options?: RegisterOptions
): AccessorEffect<ResonateFunc<Func>, ResonateSdkError>
export function register<Func extends AnyFunc>(
  nameOrFunc: string | Func,
  funcOrOptions?: Func | RegisterOptions,
  options?: RegisterOptions
): AccessorEffect<ResonateFunc<Func>, ResonateSdkError> {
  return use((client) => typeof nameOrFunc === "string"
    ? client.register(nameOrFunc, funcOrOptions as Func, options)
    : client.register(nameOrFunc, funcOrOptions as RegisterOptions))
}

export const setDependency = <Value>(name: string, value: Value): AccessorEffect<void, ResonateSdkError> =>
  use((client) => client.setDependency(name, value))

export function run<Definition extends Workflow.Any>(
  id: string,
  workflow: Definition,
  input: Workflow.Workflow.Input<Definition>,
  options?: ClientInvocationOptions
): AccessorEffect<
  ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
  InvalidWorkflowInput | ResonateSdkError
>
export function run<Func extends AnyFunc>(
  id: string,
  func: Func,
  ...args: FunctionRunParameters<Func>
): AccessorEffect<ResonateHandle<FunctionReturn<Func>>, ResonateSdkError>
export function run<Success = unknown>(
  ...args: SdkRunParameters
): AccessorEffect<ResonateHandle<Success>, ResonateSdkError>
export function run(
  ...args: readonly [id: string, func: Workflow.Any | AnyFunc | string, ...rest: ReadonlyArray<unknown>]
): AccessorEffect<ResonateHandle<unknown, unknown>, unknown> {
  return use((client) => (client.run as (...values: ReadonlyArray<unknown>) =>
    Effect.Effect<ResonateHandle<unknown, unknown>, unknown>)(...args))
}

export function rpc<Definition extends Workflow.Any>(
  id: string,
  workflow: Definition,
  input: Workflow.Workflow.Input<Definition>,
  options?: ClientInvocationOptions
): AccessorEffect<
  ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
  InvalidWorkflowInput | ResonateSdkError
>
export function rpc<Func extends AnyFunc>(
  id: string,
  func: Func,
  ...args: FunctionRpcParameters<Func>
): AccessorEffect<ResonateHandle<FunctionReturn<Func>>, ResonateSdkError>
export function rpc<Success = unknown>(
  ...args: SdkRpcParameters
): AccessorEffect<ResonateHandle<Success>, ResonateSdkError>
export function rpc(
  ...args: readonly [id: string, func: Workflow.Any | AnyFunc | string, ...rest: ReadonlyArray<unknown>]
): AccessorEffect<ResonateHandle<unknown, unknown>, unknown> {
  return use((client) => (client.rpc as (...values: ReadonlyArray<unknown>) =>
    Effect.Effect<ResonateHandle<unknown, unknown>, unknown>)(...args))
}

export function get<Definition extends Workflow.Any>(id: string, workflow: Definition): AccessorEffect<
  ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
  ResonateSdkError
>
export function get<Success = unknown>(id: string): AccessorEffect<ResonateHandle<Success>, ResonateSdkError>
export function get(
  id: string,
  workflow?: Workflow.Any
): AccessorEffect<ResonateHandle<unknown, unknown>, ResonateSdkError> {
  return use((client) => (client.get as (...values: ReadonlyArray<unknown>) =>
    Effect.Effect<ResonateHandle<unknown, unknown>, ResonateSdkError>)(id, workflow))
}

export function schedule<Func extends AnyFunc>(
  name: string,
  cron: string,
  func: Func,
  ...args: FunctionRunParameters<Func>
): AccessorEffect<ResonateSchedule, ResonateSdkError>
export function schedule(
  ...args: SdkScheduleParameters
): AccessorEffect<ResonateSchedule, ResonateSdkError>
export function schedule(
  ...args: readonly [name: string, cron: string, func: AnyFunc | string, ...rest: ReadonlyArray<unknown>]
): AccessorEffect<ResonateSchedule, ResonateSdkError> {
  return use((client) => (client.schedule as (...values: ReadonlyArray<unknown>) =>
    Effect.Effect<ResonateSchedule, ResonateSdkError>)(...args))
}

export const options = (input?: OptionsInput): AccessorEffect<Options, ResonateSdkError> =>
  use((client) => client.options(input))

const settle = (
  operation: "resolve" | "reject" | "cancel",
  args: ReadonlyArray<unknown>
): AccessorEffect<PromiseResolveResult | PromiseRejectResult | PromiseCancelResult, DurableProtocolError | ResonateSdkError> =>
  use((client) => (client.promises[operation] as (...values: ReadonlyArray<unknown>) =>
    Effect.Effect<PromiseResolveResult | PromiseRejectResult | PromiseCancelResult,
      DurableProtocolError | ResonateSdkError>)(...args))

function resolve(...args: PromiseResolveParameters): AccessorEffect<PromiseResolveResult, ResonateSdkError>
function resolve<Value, Encoded extends DurableValue>(
  id: string,
  schema: Schema.Codec<Value, Encoded, never, never>,
  value: Value
): AccessorEffect<PromiseResolveResult, DurableProtocolError | ResonateSdkError>
function resolve(...args: ReadonlyArray<unknown>) {
  return settle("resolve", args)
}

function reject(...args: PromiseRejectParameters): AccessorEffect<PromiseRejectResult, ResonateSdkError>
function reject<Value, Encoded extends DurableValue>(
  id: string,
  schema: Schema.Codec<Value, Encoded, never, never>,
  value: Value
): AccessorEffect<PromiseRejectResult, DurableProtocolError | ResonateSdkError>
function reject(...args: ReadonlyArray<unknown>) {
  return settle("reject", args)
}

function cancel(...args: PromiseCancelParameters): AccessorEffect<PromiseCancelResult, ResonateSdkError>
function cancel<Value, Encoded extends DurableValue>(
  id: string,
  schema: Schema.Codec<Value, Encoded, never, never>,
  value: Value
): AccessorEffect<PromiseCancelResult, DurableProtocolError | ResonateSdkError>
function cancel(...args: ReadonlyArray<unknown>) {
  return settle("cancel", args)
}

export const promises = {
  get: (...args: PromiseGetParameters): AccessorEffect<PromiseGetResult, ResonateSdkError> =>
    use((client) => client.promises.get(...args)),
  create: (...args: PromiseCreateParameters): AccessorEffect<PromiseCreateResult, ResonateSdkError> =>
    use((client) => client.promises.create(...args)),
  createWithTask: (...args: PromiseCreateWithTaskParameters): AccessorEffect<
    PromiseCreateWithTaskResult,
    ResonateSdkError
  > => use((client) => client.promises.createWithTask(...args)),
  resolve,
  reject,
  cancel,
  registerCallback: (...args: PromiseRegisterCallbackParameters): AccessorEffect<
    PromiseRegisterCallbackResult,
    ResonateSdkError
  > => use((client) => client.promises.registerCallback(...args)),
  registerListener: (...args: PromiseRegisterListenerParameters): AccessorEffect<
    PromiseRegisterListenerResult,
    ResonateSdkError
  > => use((client) => client.promises.registerListener(...args))
} as const

export const schedules = {
  get: (...args: ScheduleGetParameters): AccessorEffect<ScheduleGetResult, ResonateSdkError> =>
    use((client) => client.schedules.get(...args)),
  create: (...args: ScheduleCreateParameters): AccessorEffect<ScheduleCreateResult, ResonateSdkError> =>
    use((client) => client.schedules.create(...args)),
  delete: (...args: ScheduleDeleteParameters): AccessorEffect<ScheduleDeleteResult, ResonateSdkError> =>
    use((client) => client.schedules.delete(...args))
} as const

export const stop = (): AccessorEffect<void, ResonateSdkError> => use((client) => client.stop())

export type AcquisitionError =
  | InvalidDefinition
  | DuplicateDefinition
  | InvalidClientConfiguration
  | ResonateSdkError

/** Acquires one ready Resonate runtime without declarative preregistration. */
export function layer(options: LayerOptions): Layer.Layer<ResonateClient, AcquisitionError, ResonateNetwork>
/** Acquires one ready Resonate runtime and atomically preregisters a closed function group. */
export function layer<Group extends ResonateFunctions.Any>(
  options: LayerOptions<Group> & { readonly functions: Group }
): Layer.Layer<
  ResonateClient,
  AcquisitionError,
  ResonateNetwork | ResonateFunctions.Handlers<Group>
>
export function layer(
  options: LayerOptions | LayerOptions<ResonateFunctions.Any>
): Layer.Layer<ResonateClient, AcquisitionError, ResonateNetwork | ResonateFunctions.Handlers<ResonateFunctions.Any>> {
  return Layer.effect(
    ResonateClient,
    ClientLive.make(
      options.functions as ResonateFunctions.Any,
      options as LayerOptions<ResonateFunctions.Any>
    )
  ).pipe(
    Layer.provide(AdapterSupervisor.layer)
  )
}
