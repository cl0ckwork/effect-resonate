import { Context } from "effect"

/** Read-only metadata for one durable step attempt. */
export interface StepContextService {
  readonly id: string
  readonly parentId: string
  readonly originId: string
  readonly branchId: string
  readonly timeoutAt: number
  readonly attempt: number
  readonly version: number
  readonly name: string
}

/** Per-invocation Effect service supplied by the step adapter. */
export class StepContext extends Context.Service<StepContext, StepContextService>()(
  "@effect-resonate/core/StepContext"
) {}
