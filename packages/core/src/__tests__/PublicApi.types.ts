import type { PromiseRecord, ScheduleRecord } from "@resonatehq/sdk"
import {
  Exponential,
  type Context as SdkContext,
  type Resonate as SdkResonate,
  type ResonateFunc as SdkResonateFunc,
  type ResonateHandle as SdkResonateHandle,
  type ResonateSchedule as SdkResonateSchedule
} from "@resonatehq/sdk/async"
import { Context, Effect, Layer, Result, Schema } from "effect"
import {
  CoreExecutionError,
  ResonateClient,
  ResonateClientService,
  ResonateFunctions,
  ResonateNetwork,
  ResonateNetworkService,
  Step,
  StepContext,
  Workflow,
  type WorkflowContext
} from "../index.js"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Assert<Condition extends true> = Condition

class Inventory extends Context.Service<Inventory, {
  readonly reserve: (sku: string) => Effect.Effect<{ readonly reservationId: string }, { readonly reason: string }>
}>()("test/Inventory") {}

const Reserve = Step.make({
  name: "inventory.reserve",
  version: 1,
  input: Schema.Struct({ sku: Schema.String }),
  success: Schema.Struct({ reservationId: Schema.String, stepId: Schema.String }),
  failure: Schema.Struct({ reason: Schema.String })
})

const ReserveLive = Reserve.toLayer((input) =>
  Effect.gen(function*() {
    const inventory = yield* Inventory
    const context = yield* StepContext
    const reservation = yield* inventory.reserve(input.sku)
    return { reservationId: reservation.reservationId, stepId: context.id }
  }))

type _StepInput = Assert<Equal<Step.Step.Input<typeof Reserve>, { readonly sku: string }>>
type _StepSuccess = Assert<
  Equal<Step.Step.Success<typeof Reserve>, { readonly reservationId: string; readonly stepId: string }>
>
type _StepFailure = Assert<Equal<Step.Step.Failure<typeof Reserve>, { readonly reason: string }>>
type _StepLayerRequirements = Assert<Equal<Layer.Services<typeof ReserveLive>, Inventory>>
type _StepLayerOutput = Assert<Equal<Layer.Success<typeof ReserveLive>, Step.Handler<typeof Reserve>>>

const ReserveV2 = Step.evolve(Reserve, {
  version: 2,
  input: Schema.Struct({ sku: Schema.String, quantity: Schema.Number }),
  success: Schema.Struct({ reservationId: Schema.String }),
  failure: Schema.Struct({ reason: Schema.String, retryable: Schema.Boolean })
})

type _EvolvedStepName = Assert<Equal<Step.Step.Name<typeof ReserveV2>, "inventory.reserve">>
type _EvolvedStepVersion = Assert<Equal<Step.Step.Version<typeof ReserveV2>, 2>>
type _EvolvedStepPrevious = Assert<Equal<typeof ReserveV2.previous, typeof Reserve>>
type _EvolvedStepInput = Assert<
  Equal<Step.Step.Input<typeof ReserveV2>, { readonly sku: string; readonly quantity: number }>
>
const ReserveV2Live = ReserveV2.toLayer(() => Effect.succeed({ reservationId: "reservation-1" }))
type _EvolvedStepLayerOutput = Assert<
  Equal<Layer.Success<typeof ReserveV2Live>, Step.Handler<typeof ReserveV2>>
>

const Checkout = Workflow.make({
  name: "checkout",
  version: 1,
  input: Schema.Struct({ sku: Schema.String }),
  success: Schema.Struct({ reservationId: Schema.String }),
  failure: Schema.Struct({ reason: Schema.String })
})

const CheckoutLive = Checkout.toLayer(async (context, input) => {
  const reservation = await context.run(Reserve, { sku: input.sku })
  if (Result.isFailure(reservation)) {
    return Result.fail(reservation.failure)
  }
  return Result.succeed({ reservationId: reservation.success.reservationId })
})

type _WorkflowInput = Assert<Equal<Workflow.Workflow.Input<typeof Checkout>, { readonly sku: string }>>
type _WorkflowSuccess = Assert<
  Equal<Workflow.Workflow.Success<typeof Checkout>, { readonly reservationId: string }>
>
type _WorkflowFailure = Assert<Equal<Workflow.Workflow.Failure<typeof Checkout>, { readonly reason: string }>>
type _WorkflowLayerOutput = Assert<Equal<Layer.Success<typeof CheckoutLive>, Workflow.Handler<typeof Checkout>>>

const CheckoutV2 = Workflow.evolve(Checkout, {
  version: 2,
  input: Schema.Struct({ sku: Schema.String, quantity: Schema.Number }),
  success: Schema.Struct({ reservationId: Schema.String }),
  failure: Schema.Struct({ reason: Schema.String })
})

type _EvolvedWorkflowName = Assert<Equal<Workflow.Workflow.Name<typeof CheckoutV2>, "checkout">>
type _EvolvedWorkflowVersion = Assert<Equal<Workflow.Workflow.Version<typeof CheckoutV2>, 2>>
type _EvolvedWorkflowPrevious = Assert<Equal<typeof CheckoutV2.previous, typeof Checkout>>
const CheckoutV2Live = CheckoutV2.toLayer(async () => Result.succeed({ reservationId: "reservation-1" }))
type _EvolvedWorkflowLayerOutput = Assert<
  Equal<Layer.Success<typeof CheckoutV2Live>, Workflow.Handler<typeof CheckoutV2>>
>

const CheckoutFunctions = ResonateFunctions.make(Reserve, Checkout)

type _Functions = Assert<
  Equal<ResonateFunctions.Functions<typeof CheckoutFunctions>, typeof Reserve | typeof Checkout>
>
type _FunctionSteps = Assert<Equal<ResonateFunctions.Steps<typeof CheckoutFunctions>, typeof Reserve>>
type _FunctionWorkflows = Assert<Equal<ResonateFunctions.Workflows<typeof CheckoutFunctions>, typeof Checkout>>
type _FunctionHandlers = Assert<
  Equal<
    ResonateFunctions.Handlers<typeof CheckoutFunctions>,
    Step.Handler<typeof Reserve> | Workflow.Handler<typeof Checkout>
  >
>

const ClientLayer = ResonateClient.layer({
  functions: CheckoutFunctions,
  drainTimeout: "30 seconds",
  url: "https://resonate.example.test",
  group: "checkout",
  pid: "worker-1",
  ttl: 60_000,
  token: "token",
  timeout: 10_000,
  verbose: true,
  logLevel: "debug"
})
type SdkClientOptions = NonNullable<ConstructorParameters<typeof SdkResonate>[0]>
type _ClientOptionParity = Assert<Equal<
  keyof ResonateClient.ClientOptions,
  Exclude<keyof SdkClientOptions, "network">
>>
type _ClientLayerOutput = Assert<Equal<Layer.Success<typeof ClientLayer>, ResonateClientService>>
type _ClientLayerRequirements = Assert<
  Equal<Layer.Services<typeof ClientLayer>, ResonateNetworkService | ResonateFunctions.Handlers<typeof CheckoutFunctions>>
>

declare const compatibleNetwork: ResonateNetwork.CompatibleNetwork
// @ts-expect-error the network instance is supplied by the ResonateNetwork Layer
ResonateClient.layer({ drainTimeout: "30 seconds", network: compatibleNetwork })
const NetworkLive = ResonateNetwork.make({
  factory: Effect.succeed(compatibleNetwork)
})
const ConfiguredClientLayer = ClientLayer.pipe(Layer.provide([
  NetworkLive,
  ReserveLive,
  CheckoutLive
]))
type _ConfiguredClientRequirements = Assert<Equal<Layer.Services<typeof ConfiguredClientLayer>, Inventory>>

declare const client: ResonateClient.ResonateClientService
const clientRun = client.run("checkout-1", Checkout, { sku: "sku-1" })
type _ClientRunSuccess = Assert<
  Equal<
    Effect.Success<typeof clientRun>,
    ResonateClient.ResonateHandle<
      { readonly reservationId: string },
      ResonateClient.TypedResultError<typeof Checkout>
    >
  >
>
type _ClientRunError = Assert<
  Equal<
    Effect.Error<typeof clientRun>,
    CoreExecutionError.InvalidWorkflowInput | CoreExecutionError.ResonateSdkError
  >
>

declare const typedHandle: Effect.Success<typeof clientRun>
const typedResult = typedHandle.result()
const typedDone = typedHandle.done()
type _TypedResultSuccess = Assert<
  Equal<Effect.Success<typeof typedResult>, { readonly reservationId: string }>
>
type _TypedResultError = Assert<
  Equal<Effect.Error<typeof typedResult>, ResonateClient.TypedResultError<typeof Checkout>>
>
type _TypedDone = Assert<Equal<Effect.Success<typeof typedDone>, boolean>>

const rawFunction = async (_context: SdkContext, sku: string) => ({ sku })
const rawRun = client.run("raw-1", rawFunction, "sku-1")
declare const rawTarget: typeof rawFunction | string
const rawUnionRun = client.run<{ readonly sku: string }>("raw-union-1", rawTarget, "sku-1")
const rawExplicitRun = client.run<{ readonly sku: string }>("raw-explicit-1", rawFunction, "sku-1")
const rawUnionRpc = client.rpc<{ readonly sku: string }>("raw-union-rpc-1", rawTarget, "sku-1")
const rawExplicitRpc = client.rpc<{ readonly sku: string }>("raw-explicit-rpc-1", rawFunction, "sku-1")
const rawZeroArgumentFunction = async (_context: SdkContext) => "ready"
const rawZeroArgumentRun = client.run("raw-zero-1", rawZeroArgumentFunction)
type _RawRunSuccess = Assert<
  Equal<
    Effect.Success<typeof rawRun>,
    ResonateClient.ResonateHandle<{ sku: string }, CoreExecutionError.ResonateSdkError>
  >
>
type _RawRunError = Assert<Equal<Effect.Error<typeof rawRun>, CoreExecutionError.ResonateSdkError>>
type _RawUnionRun = Assert<Equal<Effect.Success<typeof rawUnionRun>, Effect.Success<typeof rawExplicitRun>>>
type _RawUnionRpc = Assert<Equal<Effect.Success<typeof rawUnionRpc>, Effect.Success<typeof rawExplicitRpc>>>
type _RawZeroArgumentRun = Assert<Equal<
  Effect.Success<typeof rawZeroArgumentRun>,
  ResonateClient.ResonateHandle<string, CoreExecutionError.ResonateSdkError>
>>

const rawNamedRun = client.run<{ readonly accepted: boolean }>(
  "raw-named-1",
  "accept",
  { requestId: "request-1" }
)
type _RawNamedRun = Assert<
  Equal<
    Effect.Success<typeof rawNamedRun>,
    ResonateClient.ResonateHandle<{ readonly accepted: boolean }, CoreExecutionError.ResonateSdkError>
  >
>

const registered = client.register("inventory.raw", rawFunction, { version: 2 })
type _RegisteredFunction = Assert<
  Equal<Effect.Success<typeof registered>, ResonateClient.ResonateFunc<typeof rawFunction>>
>
declare const registeredFunction: Effect.Success<typeof registered>
registeredFunction.options({ nonRetryableErrors: [TypeError] })
const registeredRun = registeredFunction.run("inventory-raw-1", "sku-1")
const registeredRpc = registeredFunction.rpc("inventory-raw-2", "sku-2")
type _RegisteredRun = Assert<Equal<
  Effect.Success<typeof registeredRun>,
  ResonateClient.ResonateHandle<{ sku: string }, CoreExecutionError.ResonateSdkError>
>>
type _RegisteredRpc = Assert<Equal<Effect.Success<typeof registeredRpc>, Effect.Success<typeof registeredRun>>>

const rawSchedule = client.schedule("inventory-hourly", "0 * * * *", rawFunction, "sku-1")
type _RawSchedule = Assert<Equal<Effect.Success<typeof rawSchedule>, ResonateClient.ResonateSchedule>>

const rawGet = client.get<number>("promise-1")
type _RawGet = Assert<
  Equal<Effect.Success<typeof rawGet>, ResonateClient.ResonateHandle<number, CoreExecutionError.ResonateSdkError>>
>

const typedGet = client.get("checkout-1", Checkout)
type _TypedGet = Assert<Equal<Effect.Success<typeof typedGet>, Effect.Success<typeof clientRun>>>

const promiseGet = client.promises.get("promise-1")
const promiseCreate = client.promises.create("promise-1", 1_000)
const promiseCreateWithTask = client.promises.createWithTask("promise-1", 1_000, "worker-1", 30_000)
const promiseResolve = client.promises.resolve("promise-1", { data: "e30=" })
const typedPromiseResolve = client.promises.resolve("promise-1", Schema.Number, 1)
const promiseCallback = client.promises.registerCallback("promise-1", "promise-2")
const promiseListener = client.promises.registerListener("promise-1", "worker-1")
type _PromiseGet = Assert<Equal<Effect.Success<typeof promiseGet>, PromiseRecord>>
type _PromiseCreate = Assert<Equal<Effect.Success<typeof promiseCreate>, PromiseRecord>>
type _PromiseCreateWithTask = Assert<
  Equal<Effect.Success<typeof promiseCreateWithTask>, Awaited<ReturnType<SdkResonate["promises"]["createWithTask"]>>>
>
type _PromiseResolve = Assert<Equal<Effect.Success<typeof promiseResolve>, PromiseRecord>>
type _PromiseResolveError = Assert<Equal<Effect.Error<typeof promiseResolve>, CoreExecutionError.ResonateSdkError>>
type _TypedPromiseResolveError = Assert<Equal<
  Effect.Error<typeof typedPromiseResolve>,
  CoreExecutionError.DurableProtocolError | CoreExecutionError.ResonateSdkError
>>
type _PromiseCallback = Assert<Equal<
  Effect.Success<typeof promiseCallback>,
  Awaited<ReturnType<SdkResonate["promises"]["registerCallback"]>>
>>
type _PromiseListener = Assert<Equal<
  Effect.Success<typeof promiseListener>,
  Awaited<ReturnType<SdkResonate["promises"]["registerListener"]>>
>>

const scheduleCreate = client.schedules.create(
  "schedule-1",
  "0 * * * *",
  "checkout-{{.timestamp}}",
  60_000
)
const scheduleGet = client.schedules.get("schedule-1")
const scheduleDelete = client.schedules.delete("schedule-1")
type _ScheduleCreate = Assert<Equal<Effect.Success<typeof scheduleCreate>, ScheduleRecord>>
type _ScheduleGet = Assert<Equal<Effect.Success<typeof scheduleGet>, ScheduleRecord>>
type _ScheduleDelete = Assert<Equal<Effect.Success<typeof scheduleDelete>, undefined>>

type _ClientSurface = Assert<Equal<keyof ResonateClient.ResonateClientService,
  | "register"
  | "setDependency"
  | "run"
  | "rpc"
  | "get"
  | "schedule"
  | "options"
  | "promises"
  | "schedules"
  | "stop"
>>
type _SdkClientSurface = Assert<Equal<keyof ResonateClient.ResonateClientService, keyof SdkResonate>>
type _PromiseSurface = Assert<Equal<keyof ResonateClient.PromisesService, keyof SdkResonate["promises"]>>
type _ScheduleSurface = Assert<Equal<keyof ResonateClient.SchedulesService, keyof SdkResonate["schedules"]>>
type _HandleSurface = Assert<Equal<
  keyof ResonateClient.ResonateHandle<unknown>,
  keyof SdkResonateHandle<unknown>
>>
type _RegisteredFunctionSurface = Assert<Equal<
  keyof ResonateClient.ResonateFunc<typeof rawFunction>,
  keyof SdkResonateFunc<typeof rawFunction>
>>
type _ScheduleHandleSurface = Assert<Equal<keyof ResonateClient.ResonateSchedule, keyof SdkResonateSchedule>>

const accessorRun = ResonateClient.run("checkout-accessor-1", Checkout, { sku: "sku-1" })
type _AccessorRunSuccess = Assert<Equal<Effect.Success<typeof accessorRun>, Effect.Success<typeof clientRun>>>
type _AccessorRunError = Assert<Equal<Effect.Error<typeof accessorRun>, Effect.Error<typeof clientRun>>>
type _AccessorRunRequirement = Assert<Equal<Effect.Services<typeof accessorRun>, ResonateClientService>>

const accessorPromise = ResonateClient.promises.get("promise-1")
const accessorSchedule = ResonateClient.schedules.get("schedule-1")
type _AccessorPromiseRequirement = Assert<Equal<Effect.Services<typeof accessorPromise>, ResonateClientService>>
type _AccessorScheduleRequirement = Assert<Equal<Effect.Services<typeof accessorSchedule>, ResonateClientService>>

// @ts-expect-error generator-only begin methods are not fabricated by the async wrapper
void client.beginRun

// @ts-expect-error generator-only begin methods are not fabricated by the async wrapper
void client.beginRpc

// @ts-expect-error invocation ids precede the workflow contract
client.run(Checkout, "checkout-1", { sku: "sku-1" })

// @ts-expect-error module accessors preserve the same positional API
ResonateClient.run(Checkout, "checkout-1", { sku: "sku-1" })

// @ts-expect-error client Layer construction accepts one named options object
ResonateClient.layer(CheckoutFunctions, { drainTimeout: "30 seconds" })

// @ts-expect-error network Layer construction accepts one named options object
ResonateNetwork.make(Effect.succeed(compatibleNetwork))

declare const context: WorkflowContext
type _WorkflowContextSurface = Assert<Equal<keyof WorkflowContext, keyof SdkContext>>

const runResult = context.run(Reserve, { sku: "sku-1" }, {
  timeout: 1_000,
  retryPolicy: new Exponential({ delay: 10, factor: 2, maxRetries: 3, maxDelay: 100 })
})
const rpcResult = context.rpc(Reserve, { sku: "sku-1" })
const currentTime = context.date.now()
const random = context.math.random()
const approval = context.promise(Schema.Struct({ approved: Schema.Boolean }))
const rawContextRun = context.run(rawFunction, "sku-1")
const rawContextRpc = context.rpc(rawFunction, "sku-1")

type _RunResult = Assert<
  Equal<
    Awaited<typeof runResult>,
    Result.Result<
      { readonly reservationId: string; readonly stepId: string },
      { readonly reason: string }
    >
  >
>
type _RpcResult = Assert<Equal<Awaited<typeof rpcResult>, Awaited<typeof runResult>>>
type _Time = Assert<Equal<Awaited<typeof currentTime>, number>>
type _Random = Assert<Equal<Awaited<typeof random>, number>>
type _Approval = Assert<Equal<Awaited<typeof approval>, { readonly approved: boolean }>>
type _RawContextRun = Assert<Equal<Awaited<typeof rawContextRun>, { sku: string }>>
type _RawContextRpc = Assert<Equal<Awaited<typeof rawContextRpc>, { sku: string }>>

// @ts-expect-error versions are required
Step.make({ name: "missing.version", input: Schema.Null, success: Schema.Null, failure: Schema.Null })

const RuntimeValidatedVersion = Step.make({
  name: "runtime.validated.version",
  version: 0,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Null
})
type _RuntimeValidatedVersion = Assert<Equal<Step.Step.Version<typeof RuntimeValidatedVersion>, 0>>

const RuntimeValidatedEvolution = Step.evolve(Reserve, {
  version: 1,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Null
})
type _RuntimeValidatedEvolution = Assert<Equal<Step.Step.Version<typeof RuntimeValidatedEvolution>, 1>>

const LargeVersion = Step.make({
  name: "large.version",
  version: 20_260_916,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Never
})

const LargeVersionV2 = Step.evolve(LargeVersion, {
  version: 20_260_917,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Never
})

type _LargeEvolvedVersion = Assert<Equal<Step.Step.Version<typeof LargeVersionV2>, 20_260_917>>

// @ts-expect-error the input is inferred from the step contract
context.run(Reserve, { sku: 1 })

declare const serviceDependentSchema: Schema.Codec<string, string, Inventory, never>

Step.make({
  name: "bad.codec",
  version: 1,
  // @ts-expect-error durable boundary codecs cannot require Effect services
  input: serviceDependentSchema,
  success: Schema.String,
  failure: Schema.String
})

Reserve.toLayer(
  // @ts-expect-error handler failures must match the declared failure schema
  () => Effect.fail({ code: 500 })
)

Checkout.toLayer(
  // @ts-expect-error workflow failures must match the declared failure schema
  async () => Result.fail({ code: 500 })
)
