import type { Info } from "@resonatehq/sdk/async"
import { Context } from "effect"

/** Read-only Resonate metadata and dependencies for one durable step attempt. */
export type StepContextService = Info

/** Per-invocation Effect service supplied by the step adapter. */
export class StepContext extends Context.Service<StepContext, StepContextService>()(
  "@effect-resonate/core/StepContext"
) {}
