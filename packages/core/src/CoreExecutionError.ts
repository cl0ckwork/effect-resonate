import type { Network } from "@resonatehq/sdk"
import type { Resonate, ResonateHandle } from "@resonatehq/sdk/async"
import { Schema } from "effect"

type MethodNames<Service> = {
  readonly [Name in keyof Service]-?: Service[Name] extends (...args: infer _Args) => infer _Return ? Name : never
}[keyof Service] & string

type ResonateOperation =
  | Extract<MethodNames<Resonate>, "register" | "run" | "rpc" | "get" | "stop">
  | `handle.${Extract<MethodNames<ResonateHandle<unknown>>, "result">}`
  | `network.${Extract<MethodNames<Network>, "init">}`
  | `promises.${Extract<MethodNames<Resonate["promises"]>, "resolve" | "reject" | "cancel">}`

const DefinitionKind = Schema.Literals(["Step", "Workflow"])

const DefinitionIssue = Schema.Literals([
  "EmptyName",
  "VersionNotPositiveInteger",
  "InvalidEvolutionLineage",
  "VersionNotIncreasing"
])

const DurableValueLocation = Schema.Literals([
  "PromiseData",
  "PromiseResolution",
  "PromiseRejection",
  "PromiseCancellation"
])

const ProtocolIssue = Schema.Literals([
  "MalformedEnvelope",
  "UnsupportedProtocolVersion",
  "InvalidDefinitionIdentity",
  "InvalidOutcome",
  "PayloadDecodeFailed",
  "PayloadEncodeFailed"
])

const ResonateOperations = [
  "network.init",
  "register",
  "run",
  "rpc",
  "get",
  "handle.result",
  "promises.resolve",
  "promises.reject",
  "promises.cancel",
  "stop"
] as const satisfies ReadonlyArray<ResonateOperation>

const ResonateOperation = Schema.Literals(ResonateOperations)

/** A definition was constructed with an invalid public identity. */
export class InvalidDefinition extends Schema.TaggedError<InvalidDefinition>()(
  "@effect-resonate/core/InvalidDefinition",
  {
    definitionKind: DefinitionKind,
    issue: DefinitionIssue
  }
) {}

/** Two contracts claimed the same globally registered Resonate identity. */
export class DuplicateDefinition extends Schema.TaggedError<DuplicateDefinition>()(
  "@effect-resonate/core/DuplicateDefinition",
  {
    definitionName: Schema.String,
    definitionVersion: Schema.Int
  }
) {}

/** Client Layer configuration was invalid before any SDK resource was started. */
export class InvalidClientConfiguration extends Schema.TaggedError<InvalidClientConfiguration>()(
  "@effect-resonate/core/InvalidClientConfiguration",
  {
    issue: Schema.Literal("DrainTimeoutNotFinite")
  }
) {}

/** A workflow input failed its boundary schema without exposing the raw value. */
export class InvalidWorkflowInput extends Schema.TaggedError<InvalidWorkflowInput>()(
  "@effect-resonate/core/InvalidWorkflowInput",
  {
    workflowName: Schema.String,
    workflowVersion: Schema.Int,
    issue: Schema.Literal("SchemaMismatch")
  }
) {}

/** A step or external-promise value was not JSON compatible. */
export class InvalidDurableValue extends Schema.TaggedError<InvalidDurableValue>()(
  "@effect-resonate/core/InvalidDurableValue",
  {
    location: DurableValueLocation,
    issue: Schema.Literal("NotJsonCompatible")
  }
) {}

/** Persisted wrapper data did not satisfy the owned durable protocol. */
export class DurableProtocolError extends Schema.TaggedError<DurableProtocolError>()(
  "@effect-resonate/core/DurableProtocolError",
  { issue: ProtocolIssue }
) {}

/** A global execution ID resolved to a different workflow identity. */
export class DefinitionConflict extends Schema.TaggedError<DefinitionConflict>()(
  "@effect-resonate/core/DefinitionConflict",
  {
    executionId: Schema.String,
    expectedName: Schema.String,
    expectedVersion: Schema.Int,
    actualName: Schema.String,
    actualVersion: Schema.Int
  }
) {}

/** A durable execution rejected for a non-domain reason. */
export class ExecutionRejected extends Schema.TaggedError<ExecutionRejected>()(
  "@effect-resonate/core/ExecutionRejected",
  {
    executionId: Schema.String,
    definitionName: Schema.String,
    definitionVersion: Schema.Int,
    reason: Schema.Literals(["Defect", "Interrupted", "CompositeCause", "ContractViolation", "Unknown"])
  }
) {}

/** A thin Effect error around an error observed at a Resonate SDK boundary. */
export class ResonateSdkError extends Schema.TaggedError<ResonateSdkError>()(
  "@effect-resonate/core/ResonateSdkError",
  {
    operation: ResonateOperation,
    cause: Schema.Defect(),
    code: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
    href: Schema.optional(Schema.String),
    retriable: Schema.optional(Schema.Boolean),
    serverStatus: Schema.optional(Schema.Int),
    requestMayHaveCommitted: Schema.Boolean
  }
) {}

export type CoreExecutionError =
  | InvalidDefinition
  | DuplicateDefinition
  | InvalidClientConfiguration
  | InvalidWorkflowInput
  | InvalidDurableValue
  | DurableProtocolError
  | DefinitionConflict
  | ExecutionRejected
  | ResonateSdkError
