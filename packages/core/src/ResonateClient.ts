import type { PromiseRecord, ScheduleRecord, TaskRecord } from "@resonatehq/sdk"
import type { AnyFunc, Resonate as SdkResonate } from "@resonatehq/sdk/async"
import { Context, type Duration, Effect, Layer, type Schema } from "effect"
import type {
  DefinitionConflict,
  DurableProtocolError,
  ExecutionRejected,
  InvalidClientConfiguration,
  InvalidDefinition,
  InvalidWorkflowInput,
  DuplicateDefinition,
  ResonateSdkError
} from "./CoreExecutionError.js"
import type { Type as DurableValue } from "./DurableValue.js"
import type * as ResonateFunctions from "./ResonateFunctions.js"
import { ResonateNetwork } from "./ResonateNetwork.js"
import type * as Workflow from "./Workflow.js"
import { AdapterSupervisor } from "./internal/AdapterSupervisor.js"
import * as ClientLive from "./internal/ClientLive.js"

type MethodParameters<Method> = Method extends (...args: infer Parameters) => unknown ? Parameters : never

type FunctionArguments<Func extends AnyFunc> = Func extends (
  context: infer _Context,
  ...args: infer Arguments
) => infer _Return ? Arguments : never

type FunctionReturn<Func extends AnyFunc> = Func extends (...args: infer _Arguments) => infer Return
  ? Awaited<Return>
  : never

type SdkPromises = SdkResonate["promises"]
type SdkSchedules = SdkResonate["schedules"]

type SdkClientOptions = NonNullable<ConstructorParameters<typeof SdkResonate>[0]>

/**
 * Async SDK runtime options that still apply when the transport is supplied by
 * `ResonateNetwork`. Connection selection (`url`, `group`, `token`, `timeout`,
 * and `network`) belongs to that Layer and is intentionally not accepted here.
 */
export type ClientOptions = Pick<
  SdkClientOptions,
  "pid" | "ttl" | "verbose" | "logLevel" | "logger" | "encryptor"
>

/** The concrete options object built by the installed async SDK. */
export type Options = ReturnType<SdkResonate["options"]>

/** The fields accepted by the installed async SDK's options builder. */
export type OptionsInput = MethodParameters<SdkResonate["options"]>[0]

/** Root invocation options accepted by the installed async client, with the definition supplying `version`. */
export type ClientInvocationOptions = Omit<NonNullable<OptionsInput>, "version">

export type RegisterOptions = MethodParameters<SdkResonate["register"]>[1]

export interface NamedRegisterRequest<Func extends AnyFunc> {
  readonly name: string
  readonly func: Func
  readonly options?: RegisterOptions
}

export interface InferredRegisterRequest<Func extends AnyFunc> {
  readonly func: Func
  readonly options?: RegisterOptions
}

export type RegisterRequest<Func extends AnyFunc> = NamedRegisterRequest<Func> | InferredRegisterRequest<Func>

type FunctionArgumentField<Func extends AnyFunc | string> = Func extends AnyFunc
  ? FunctionArguments<Func> extends []
    ? { readonly args?: FunctionArguments<Func> }
    : { readonly args: FunctionArguments<Func> }
  : { readonly args?: ReadonlyArray<unknown> }

export type RawInvocationRequest<Func extends AnyFunc | string> = {
  readonly id: string
  readonly func: Func
  readonly options?: Options
} & FunctionArgumentField<Func>

export interface TypedInvocationRequest<Definition extends Workflow.Any> {
  readonly workflow: Definition
  readonly id: string
  readonly input: Workflow.Workflow.Input<Definition>
  readonly options?: ClientInvocationOptions
}

export type InvocationRequest =
  | RawInvocationRequest<AnyFunc | string>
  | TypedInvocationRequest<Workflow.Any>

export interface GetRequest {
  readonly id: string
}

export interface TypedGetRequest<Definition extends Workflow.Any> {
  readonly workflow: Definition
  readonly id: string
}

export type ScheduleRequest<Func extends AnyFunc | string> = {
  readonly name: string
  readonly cron: string
  readonly func: Func
  readonly options?: Options
} & FunctionArgumentField<Func>

export interface SetDependencyRequest<Value = unknown> {
  readonly name: string
  readonly value: Value
}

export interface PromiseGetRequest {
  readonly id: MethodParameters<SdkPromises["get"]>[0]
}

export interface PromiseCreateRequest {
  readonly id: MethodParameters<SdkPromises["create"]>[0]
  readonly timeoutAt: MethodParameters<SdkPromises["create"]>[1]
  readonly options?: MethodParameters<SdkPromises["create"]>[2]
}

export interface PromiseCreateWithTaskRequest {
  readonly id: MethodParameters<SdkPromises["createWithTask"]>[0]
  readonly timeoutAt: MethodParameters<SdkPromises["createWithTask"]>[1]
  readonly pid: MethodParameters<SdkPromises["createWithTask"]>[2]
  readonly ttl: MethodParameters<SdkPromises["createWithTask"]>[3]
  readonly options?: MethodParameters<SdkPromises["createWithTask"]>[4]
}

export interface RawPromiseSettleRequest {
  readonly id: MethodParameters<SdkPromises["resolve"]>[0]
  readonly options?: MethodParameters<SdkPromises["resolve"]>[1]
}

export interface TypedPromiseSettleRequest<Value, Encoded extends DurableValue> {
  readonly id: string
  readonly schema: Schema.Codec<Value, Encoded, never, never>
  readonly value: Value
}

export interface PromiseRegisterCallbackRequest {
  readonly awaited: MethodParameters<SdkPromises["registerCallback"]>[0]
  readonly awaiter: MethodParameters<SdkPromises["registerCallback"]>[1]
}

export interface PromiseRegisterListenerRequest {
  readonly awaited: MethodParameters<SdkPromises["registerListener"]>[0]
  readonly address: MethodParameters<SdkPromises["registerListener"]>[1]
}

export interface ScheduleGetRequest {
  readonly id: MethodParameters<SdkSchedules["get"]>[0]
}

export interface ScheduleCreateRequest {
  readonly id: MethodParameters<SdkSchedules["create"]>[0]
  readonly cron: MethodParameters<SdkSchedules["create"]>[1]
  readonly promiseId: MethodParameters<SdkSchedules["create"]>[2]
  readonly promiseTimeout: MethodParameters<SdkSchedules["create"]>[3]
  readonly options?: MethodParameters<SdkSchedules["create"]>[4]
}

export interface ScheduleDeleteRequest {
  readonly id: MethodParameters<SdkSchedules["delete"]>[0]
}

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
  readonly run: (request: Omit<RawInvocationRequest<Func>, "func">) =>
    Effect.Effect<ResonateHandle<FunctionReturn<Func>>, ResonateSdkError>
  readonly rpc: (request: Omit<RawInvocationRequest<Func>, "func">) =>
    Effect.Effect<ResonateHandle<FunctionReturn<Func>>, ResonateSdkError>
  /** Bound to the owning client, correcting the unbound SDK 0.11.5 helper. */
  readonly options: (request?: OptionsInput) => Effect.Effect<Options, ResonateSdkError>
}

export interface PromisesService {
  readonly get: (request: PromiseGetRequest) => Effect.Effect<PromiseRecord, ResonateSdkError>
  readonly create: (request: PromiseCreateRequest) => Effect.Effect<PromiseRecord, ResonateSdkError>
  readonly createWithTask: (request: PromiseCreateWithTaskRequest) => Effect.Effect<{
    readonly promise: PromiseRecord
    readonly task?: TaskRecord
  }, ResonateSdkError>
  readonly resolve: {
    (request: RawPromiseSettleRequest): Effect.Effect<PromiseRecord, ResonateSdkError>
    <Value, Encoded extends DurableValue>(request: TypedPromiseSettleRequest<Value, Encoded>):
      Effect.Effect<PromiseRecord, DurableProtocolError | ResonateSdkError>
  }
  readonly reject: PromisesService["resolve"]
  readonly cancel: PromisesService["resolve"]
  readonly registerCallback: (request: PromiseRegisterCallbackRequest) => Effect.Effect<{
    readonly promise: PromiseRecord
  }, ResonateSdkError>
  readonly registerListener: (request: PromiseRegisterListenerRequest) => Effect.Effect<{
    readonly promise: PromiseRecord
  }, ResonateSdkError>
}

export interface SchedulesService {
  readonly get: (request: ScheduleGetRequest) => Effect.Effect<ScheduleRecord, ResonateSdkError>
  readonly create: (request: ScheduleCreateRequest) => Effect.Effect<ScheduleRecord, ResonateSdkError>
  readonly delete: (request: ScheduleDeleteRequest) => Effect.Effect<undefined, ResonateSdkError>
}

export interface ResonateClientService {
  readonly register: <Func extends AnyFunc>(request: RegisterRequest<Func>) =>
    Effect.Effect<ResonateFunc<Func>, ResonateSdkError>
  readonly setDependency: <Value>(request: SetDependencyRequest<Value>) => Effect.Effect<void, ResonateSdkError>
  readonly run: {
    <Definition extends Workflow.Any>(request: TypedInvocationRequest<Definition>): Effect.Effect<
      ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
      InvalidWorkflowInput | ResonateSdkError
    >
    <Func extends AnyFunc>(request: RawInvocationRequest<Func>): Effect.Effect<
      ResonateHandle<FunctionReturn<Func>>,
      ResonateSdkError
    >
    <Success = unknown>(request: RawInvocationRequest<string>): Effect.Effect<ResonateHandle<Success>, ResonateSdkError>
  }
  readonly rpc: ResonateClientService["run"]
  readonly get: {
    <Definition extends Workflow.Any>(request: TypedGetRequest<Definition>): Effect.Effect<
      ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
      ResonateSdkError
    >
    <Success = unknown>(request: GetRequest): Effect.Effect<ResonateHandle<Success>, ResonateSdkError>
  }
  readonly schedule: <Func extends AnyFunc | string>(request: ScheduleRequest<Func>) =>
    Effect.Effect<ResonateSchedule, ResonateSdkError>
  readonly options: (request?: OptionsInput) => Effect.Effect<Options, ResonateSdkError>
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

export const register = <Func extends AnyFunc>(request: RegisterRequest<Func>): AccessorEffect<
  ResonateFunc<Func>,
  ResonateSdkError
> => use((client) => client.register(request))

export const setDependency = <Value>(request: SetDependencyRequest<Value>): AccessorEffect<void, ResonateSdkError> =>
  use((client) => client.setDependency(request))

export function run<Definition extends Workflow.Any>(request: TypedInvocationRequest<Definition>): AccessorEffect<
  ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
  InvalidWorkflowInput | ResonateSdkError
>
export function run<Func extends AnyFunc>(request: RawInvocationRequest<Func>): AccessorEffect<
  ResonateHandle<FunctionReturn<Func>>,
  ResonateSdkError
>
export function run<Success = unknown>(request: RawInvocationRequest<string>): AccessorEffect<
  ResonateHandle<Success>,
  ResonateSdkError
>
export function run(request: InvocationRequest): AccessorEffect<ResonateHandle<unknown, unknown>, unknown> {
  return use((client) => client.run(request as never))
}

export function rpc<Definition extends Workflow.Any>(request: TypedInvocationRequest<Definition>): AccessorEffect<
  ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
  InvalidWorkflowInput | ResonateSdkError
>
export function rpc<Func extends AnyFunc>(request: RawInvocationRequest<Func>): AccessorEffect<
  ResonateHandle<FunctionReturn<Func>>,
  ResonateSdkError
>
export function rpc<Success = unknown>(request: RawInvocationRequest<string>): AccessorEffect<
  ResonateHandle<Success>,
  ResonateSdkError
>
export function rpc(request: InvocationRequest): AccessorEffect<ResonateHandle<unknown, unknown>, unknown> {
  return use((client) => client.rpc(request as never))
}

export function get<Definition extends Workflow.Any>(request: TypedGetRequest<Definition>): AccessorEffect<
  ResonateHandle<Workflow.Workflow.Success<Definition>, TypedResultError<Definition>>,
  ResonateSdkError
>
export function get<Success = unknown>(request: GetRequest): AccessorEffect<
  ResonateHandle<Success>,
  ResonateSdkError
>
export function get(
  request: TypedGetRequest<Workflow.Any> | GetRequest
): AccessorEffect<ResonateHandle<unknown, unknown>, ResonateSdkError> {
  return use((client) => client.get(request as never))
}

export const schedule = <Func extends AnyFunc | string>(request: ScheduleRequest<Func>): AccessorEffect<
  ResonateSchedule,
  ResonateSdkError
> => use((client) => client.schedule(request))

export const options = (request?: OptionsInput): AccessorEffect<Options, ResonateSdkError> =>
  use((client) => client.options(request))

const settle = <Value, Encoded extends DurableValue>(
  operation: "resolve" | "reject" | "cancel",
  request: RawPromiseSettleRequest | TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError> =>
  use((client) => client.promises[operation](request as never))

function resolve(request: RawPromiseSettleRequest): AccessorEffect<PromiseRecord, ResonateSdkError>
function resolve<Value, Encoded extends DurableValue>(
  request: TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError>
function resolve<Value, Encoded extends DurableValue>(
  request: RawPromiseSettleRequest | TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError> {
  return settle("resolve", request)
}

function reject(request: RawPromiseSettleRequest): AccessorEffect<PromiseRecord, ResonateSdkError>
function reject<Value, Encoded extends DurableValue>(
  request: TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError>
function reject<Value, Encoded extends DurableValue>(
  request: RawPromiseSettleRequest | TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError> {
  return settle("reject", request)
}

function cancel(request: RawPromiseSettleRequest): AccessorEffect<PromiseRecord, ResonateSdkError>
function cancel<Value, Encoded extends DurableValue>(
  request: TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError>
function cancel<Value, Encoded extends DurableValue>(
  request: RawPromiseSettleRequest | TypedPromiseSettleRequest<Value, Encoded>
): AccessorEffect<PromiseRecord, DurableProtocolError | ResonateSdkError> {
  return settle("cancel", request)
}

export const promises = {
  get: (request: PromiseGetRequest): AccessorEffect<PromiseRecord, ResonateSdkError> =>
    use((client) => client.promises.get(request)),
  create: (request: PromiseCreateRequest): AccessorEffect<PromiseRecord, ResonateSdkError> =>
    use((client) => client.promises.create(request)),
  createWithTask: (request: PromiseCreateWithTaskRequest): AccessorEffect<{
    readonly promise: PromiseRecord
    readonly task?: TaskRecord
  }, ResonateSdkError> => use((client) => client.promises.createWithTask(request)),
  resolve,
  reject,
  cancel,
  registerCallback: (request: PromiseRegisterCallbackRequest): AccessorEffect<{
    readonly promise: PromiseRecord
  }, ResonateSdkError> => use((client) => client.promises.registerCallback(request)),
  registerListener: (request: PromiseRegisterListenerRequest): AccessorEffect<{
    readonly promise: PromiseRecord
  }, ResonateSdkError> => use((client) => client.promises.registerListener(request))
} as const

export const schedules = {
  get: (request: ScheduleGetRequest): AccessorEffect<ScheduleRecord, ResonateSdkError> =>
    use((client) => client.schedules.get(request)),
  create: (request: ScheduleCreateRequest): AccessorEffect<ScheduleRecord, ResonateSdkError> =>
    use((client) => client.schedules.create(request)),
  delete: (request: ScheduleDeleteRequest): AccessorEffect<undefined, ResonateSdkError> =>
    use((client) => client.schedules.delete(request))
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
