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

const Identity = Schema.Struct({
  executionId: Schema.NonEmptyString,
  definitionName: Schema.NonEmptyString,
  definitionVersion: Schema.Int.check(Schema.isGreaterThan(0))
})

const DurableExecutionRejectedSchema = Schema.Struct({
  _tag: Schema.Literal(tag),
  ...Identity.fields,
  reason: Reason,
  source: Schema.optional(Identity)
})

export interface Source {
  readonly executionId: string
  readonly definitionName: string
  readonly definitionVersion: number
}

export interface DurableExecutionRejected {
  readonly _tag: typeof tag
  readonly executionId: string
  readonly definitionName: string
  readonly definitionVersion: number
  readonly reason: ExecutionRejected["reason"]
  readonly source?: Source
}

export const make = (
  definition: StepAny | WorkflowAny,
  executionId: string,
  reason: ExecutionRejected["reason"],
  source?: Source
): DurableExecutionRejected => ({
  _tag: tag,
  executionId,
  definitionName: definition.name,
  definitionVersion: definition.version,
  reason,
  ...(source === undefined ? {} : { source })
})

const ownValue = (input: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(input, key)?.value

const decodeCandidate = (input: unknown): unknown =>
  input instanceof Error
    ? {
        _tag: ownValue(input, "_tag"),
        executionId: ownValue(input, "executionId"),
        definitionName: ownValue(input, "definitionName"),
        definitionVersion: ownValue(input, "definitionVersion"),
        reason: ownValue(input, "reason"),
        ...(ownValue(input, "source") === undefined ? {} : { source: ownValue(input, "source") })
      }
    : input

export const decode = (input: unknown): Option.Option<ExecutionRejected> =>
  Option.map(
    Schema.decodeUnknownOption(DurableExecutionRejectedSchema, {
      onExcessProperty: "error"
    })(decodeCandidate(input)),
    (decoded) => new ExecutionRejected(decoded)
  )

export const encode = (error: ExecutionRejected): DurableExecutionRejected => ({
  _tag: tag,
  executionId: error.executionId,
  definitionName: error.definitionName,
  definitionVersion: error.definitionVersion,
  reason: error.reason,
  ...(error.source === undefined ? {} : { source: error.source })
})
