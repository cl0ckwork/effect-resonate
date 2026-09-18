import type {
  Context as SdkContext,
  DetachedHandle,
  DurablePromise,
  Info
} from "@resonatehq/sdk/async"
import { Exponential } from "@resonatehq/sdk/async"
import { Result, Schema } from "effect"
import * as Step from "../Step.js"
import type { StepContextService } from "../StepContext.js"
import * as Workflow from "../Workflow.js"
import type { WorkflowContext } from "../WorkflowContext.js"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Assert<Condition extends true> = Condition

type _StepInfoParity = Assert<Equal<StepContextService, Info>>
type _WorkflowContextSurface = Assert<Equal<keyof WorkflowContext, keyof SdkContext>>

declare const context: WorkflowContext

const rawFunction = async (_context: SdkContext, count: number): Promise<string> => String(count)
const rawRun = context.run(rawFunction, 1, context.options({ timeout: 1_000 }))
const rawRpc = context.rpc<boolean>("inventory.ready", "sku-1")
const rawDetached = context.detached(rawFunction, 1)
const rawPromise = context.promise<{ readonly approved: boolean }>({
  data: { orderId: "order-1" },
  tags: { tenant: "acme" }
})

type _RawRun = Assert<Equal<typeof rawRun, DurablePromise<string>>>
type _RawRpc = Assert<Equal<typeof rawRpc, DurablePromise<boolean>>>
type _RawDetached = Assert<Equal<typeof rawDetached, DurablePromise<DetachedHandle>>>
type _RawPromise = Assert<Equal<typeof rawPromise, DurablePromise<{ readonly approved: boolean }>>>

const Reserve = Step.make({
  name: "inventory.reserve",
  version: 3,
  input: Schema.Struct({ sku: Schema.String }),
  success: Schema.Struct({ reservationId: Schema.String }),
  failure: Schema.Struct({ reason: Schema.String })
})

const Checkout = Workflow.make({
  name: "checkout",
  version: 2,
  input: Schema.Struct({ orderId: Schema.String }),
  success: Schema.Null,
  failure: Schema.Never
})

const typedRun = context.run(Reserve, { sku: "sku-1" }, {
  retryPolicy: new Exponential({ maxRetries: 3 }),
  nonRetryableErrors: [TypeError]
})
const typedDetached = context.detached(Checkout, { orderId: "order-1" })
const typedPromise = context.promise(Schema.Struct({ approved: Schema.Boolean }), {
  tags: { tenant: "acme" }
})

type _TypedRun = Assert<Equal<
  Awaited<typeof typedRun>,
  Result.Result<{ readonly reservationId: string }, { readonly reason: string }>
>>
type _TypedDetached = Assert<Equal<typeof typedDetached, DurablePromise<DetachedHandle>>>
type _TypedPromise = Assert<Equal<
  Awaited<typeof typedPromise>,
  { readonly approved: boolean }
>>

// @ts-expect-error exact definition versions are supplied by the wrapper
context.run(Reserve, { sku: "sku-1" }, { version: 2 })

// @ts-expect-error typed step inputs are schema-derived
context.rpc(Reserve, { sku: 1 })

// @ts-expect-error typed detached workflow inputs are schema-derived
context.detached(Checkout, { orderId: 1 })

// @ts-expect-error the async engine does not expose generator-only beginRun
type _NoBeginRun = WorkflowContext["beginRun"]
