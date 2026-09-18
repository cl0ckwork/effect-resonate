import { Context, Effect, Layer, Result, Schema } from "effect"
import {
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

class CheckoutFunctions extends ResonateFunctions.make(Reserve, Checkout) {}

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
  drainTimeout: "30 seconds"
})
type _ClientLayerOutput = Assert<Equal<Layer.Success<typeof ClientLayer>, ResonateClientService>>
type _ClientLayerRequirements = Assert<
  Equal<Layer.Services<typeof ClientLayer>, ResonateNetworkService | ResonateFunctions.Handlers<typeof CheckoutFunctions>>
>

declare const compatibleNetwork: ResonateNetwork.CompatibleNetwork
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
const clientRun = client.run({
  workflow: Checkout,
  id: "checkout-1",
  input: { sku: "sku-1" }
})
type _ClientRunSuccess = Assert<
  Equal<Effect.Success<typeof clientRun>, { readonly reservationId: string }>
>
type _ClientRunError = Assert<
  Equal<Effect.Error<typeof clientRun>, ResonateClient.InvocationError<typeof Checkout>>
>

// @ts-expect-error public client operations accept one named request object
client.run(Checkout, "checkout-1", { sku: "sku-1" })

// @ts-expect-error client Layer construction accepts one named options object
ResonateClient.layer(CheckoutFunctions, { drainTimeout: "30 seconds" })

// @ts-expect-error network Layer construction accepts one named options object
ResonateNetwork.make(Effect.succeed(compatibleNetwork))

declare const context: WorkflowContext

const runResult = context.run(Reserve, { sku: "sku-1" }, {
  timeout: 1_000,
  retry: { _tag: "Exponential", delay: 10, factor: 2, maxRetries: 3, maxDelay: 100 }
})
const rpcResult = context.rpc(Reserve, { sku: "sku-1" })
const currentTime = context.date.now()
const random = context.math.random()
const approval = context.promise(Schema.Struct({ approved: Schema.Boolean }))

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

// @ts-expect-error versions are required
Step.make({ name: "missing.version", input: Schema.Null, success: Schema.Null, failure: Schema.Null })

// @ts-expect-error literal versions must be positive integers
Step.make({ name: "zero.version", version: 0, input: Schema.Null, success: Schema.Null, failure: Schema.Null })

// @ts-expect-error literal versions must be positive integers
Step.make({ name: "negative.version", version: -1, input: Schema.Null, success: Schema.Null, failure: Schema.Null })

// @ts-expect-error literal versions must be integers
Step.make({ name: "fraction.version", version: 1.5, input: Schema.Null, success: Schema.Null, failure: Schema.Null })

// @ts-expect-error evolved versions must be newer than their predecessor
Step.evolve(Reserve, {
  version: 1,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Null
})

// @ts-expect-error evolved versions cannot move backwards
Step.evolve(ReserveV2, {
  version: 1,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Null
})

// @ts-expect-error evolved versions must be positive integers
Workflow.evolve(Checkout, {
  version: 0,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Null
})

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
