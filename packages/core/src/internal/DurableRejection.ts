import { Option, Schema } from "effect"
import { ExecutionRejected } from "../CoreExecutionError.js"
import type { Any as StepAny } from "../Step.js"
import type { Any as WorkflowAny } from "../Workflow.js"

const tag = "@effect-resonate/core/ExecutionRejected" as const

const Reason = Schema.Literals([
  "Defect",
  "Interrupted",
  "CompositeCause",
  "ContractViolation",
  "Unknown"
])

const DurableExecutionRejectedSchema = Schema.Struct({
  _tag: Schema.Literal(tag),
  executionId: Schema.String,
  definitionName: Schema.String,
  definitionVersion: Schema.Int,
  reason: Reason
})

export interface DurableExecutionRejected {
  readonly _tag: typeof tag
  readonly executionId: string
  readonly definitionName: string
  readonly definitionVersion: number
  readonly reason: ExecutionRejected["reason"]
}

export const make = (
  definition: StepAny | WorkflowAny,
  executionId: string,
  reason: ExecutionRejected["reason"]
): DurableExecutionRejected => ({
  _tag: tag,
  executionId,
  definitionName: definition.name,
  definitionVersion: definition.version,
  reason
})

export const decode = (input: unknown): Option.Option<ExecutionRejected> =>
  Option.map(
    Schema.decodeUnknownOption(DurableExecutionRejectedSchema, {
      onExcessProperty: "error"
    })(input),
    (decoded) => new ExecutionRejected(decoded)
  )

export const encode = (error: ExecutionRejected): DurableExecutionRejected => ({
  _tag: tag,
  executionId: error.executionId,
  definitionName: error.definitionName,
  definitionVersion: error.definitionVersion,
  reason: error.reason
})
