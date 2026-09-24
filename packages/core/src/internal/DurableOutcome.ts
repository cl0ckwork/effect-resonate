import { Match, Result, Schema } from "effect"
import {
  DefinitionConflict,
  type DurableProtocolError,
  type InvalidWorkflowInput
} from "../CoreExecutionError.js"
import type { Type as DurableValue } from "../DurableValue.js"
import type * as Step from "../Step.js"
import type * as Workflow from "../Workflow.js"
import { protocolError, workflowInputError } from "./Redaction.js"
import {
  decodeSchema,
  decodeWorkflowPayload,
  durableCodec,
  encodeWorkflowPayload
} from "./SchemaBoundary.js"

export const protocolVersion = 1 as const

export interface DurableDefinitionIdentity {
  readonly kind: "Step" | "Workflow"
  readonly name: string
  readonly version: number
}

export interface DurableIssue {
  readonly _tag: "SchemaMismatch"
}

interface Common {
  readonly protocolVersion: typeof protocolVersion
  readonly definition: DurableDefinitionIdentity
}

export interface Success<A extends DurableValue> extends Common {
  readonly _tag: "Success"
  readonly value: A
}

export interface Failure<E extends DurableValue> extends Common {
  readonly _tag: "Failure"
  readonly error: E
}

export interface InvalidInput extends Common {
  readonly _tag: "InvalidInput"
  readonly issue: DurableIssue
}

export type DurableOutcome<A extends DurableValue, E extends DurableValue> =
  Success<A> | Failure<E> | InvalidInput

const PositiveVersion = Schema.Int.check(Schema.isGreaterThan(0))
const DefinitionIdentitySchema = Schema.Struct({
  kind: Schema.Literals(["Step", "Workflow"]),
  name: Schema.String,
  version: PositiveVersion
})
const EnvelopeShellSchema = Schema.Struct({
  protocolVersion: Schema.Unknown,
  definition: Schema.Unknown,
  _tag: Schema.Unknown
})
const CommonEnvelopeSchema = Schema.Struct({
  protocolVersion: Schema.Int,
  definition: Schema.Unknown,
  _tag: Schema.String
})
const DurableIssueSchema = Schema.Struct({
  _tag: Schema.Literal("SchemaMismatch")
})

const SuccessSchema = Schema.Struct({
  protocolVersion: Schema.Literal(protocolVersion),
  definition: DefinitionIdentitySchema,
  _tag: Schema.Literal("Success"),
  value: Schema.Unknown
})
const FailureSchema = Schema.Struct({
  protocolVersion: Schema.Literal(protocolVersion),
  definition: DefinitionIdentitySchema,
  _tag: Schema.Literal("Failure"),
  error: Schema.Unknown
})
const InvalidInputSchema = Schema.Struct({
  protocolVersion: Schema.Literal(protocolVersion),
  definition: DefinitionIdentitySchema,
  _tag: Schema.Literal("InvalidInput"),
  issue: DurableIssueSchema
})

const loose = { onExcessProperty: "ignore" } as const

export const identityOf = (definition: Step.Any | Workflow.Any): DurableDefinitionIdentity => ({
  kind: definition.kind,
  name: definition.name,
  version: definition.version
})

export const success = <A extends DurableValue>(
  definition: DurableDefinitionIdentity,
  value: A
): Success<A> => ({
  protocolVersion,
  definition,
  _tag: "Success",
  value
})

export const failure = <E extends DurableValue>(
  definition: DurableDefinitionIdentity,
  error: E
): Failure<E> => ({
  protocolVersion,
  definition,
  _tag: "Failure",
  error
})

export const invalidInput = (definition: DurableDefinitionIdentity): InvalidInput => ({
  protocolVersion,
  definition,
  _tag: "InvalidInput",
  issue: { _tag: "SchemaMismatch" }
})

const sameIdentity = (left: DurableDefinitionIdentity, right: DurableDefinitionIdentity): boolean =>
  left.kind === right.kind && left.name === right.name && left.version === right.version

const decodeEnvelope = <IdentityError>(
  input: unknown,
  expected: DurableDefinitionIdentity,
  onIdentityMismatch: (actual: DurableDefinitionIdentity) => IdentityError
): Result.Result<
  DurableOutcome<DurableValue, DurableValue>,
  DurableProtocolError | IdentityError
> => {
  const shell = decodeSchema(EnvelopeShellSchema, input, "MalformedEnvelope", loose)
  if (Result.isFailure(shell)) {
    return Result.fail(shell.failure)
  }

  const common = decodeSchema(CommonEnvelopeSchema, input, "MalformedEnvelope", loose)
  if (Result.isFailure(common)) {
    return Result.fail(common.failure)
  }
  if (common.success.protocolVersion !== protocolVersion) {
    return Result.fail(protocolError("UnsupportedProtocolVersion"))
  }

  const identity = decodeSchema(
    DefinitionIdentitySchema,
    common.success.definition,
    "InvalidDefinitionIdentity"
  )
  if (Result.isFailure(identity)) {
    return Result.fail(identity.failure)
  }
  if (!sameIdentity(identity.success, expected)) {
    return Result.fail(onIdentityMismatch(identity.success))
  }

  return Match.value(common.success._tag).pipe(
    Match.when("Success", () => {
      const branch = decodeSchema(SuccessSchema, input, "InvalidOutcome")
      if (Result.isFailure(branch)) {
        return Result.fail(branch.failure)
      }
      return Result.map(
        decodeSchema(Schema.Json, branch.success.value, "PayloadDecodeFailed"),
        (value) => success(identity.success, value)
      )
    }),
    Match.when("Failure", () => {
      const branch = decodeSchema(FailureSchema, input, "InvalidOutcome")
      if (Result.isFailure(branch)) {
        return Result.fail(branch.failure)
      }
      return Result.map(
        decodeSchema(Schema.Json, branch.success.error, "PayloadDecodeFailed"),
        (error) => failure(identity.success, error)
      )
    }),
    Match.when("InvalidInput", () => {
      const branch = decodeSchema(InvalidInputSchema, input, "InvalidOutcome")
      return Result.map(branch, () => invalidInput(identity.success))
    }),
    Match.orElse(() => Result.fail(protocolError("InvalidOutcome")))
  )
}

export const encodeStepResult = <Definition extends Step.Any>(
  definition: Definition,
  result: Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>
): Result.Result<DurableOutcome<DurableValue, DurableValue>, DurableProtocolError> => {
  const identity = identityOf(definition)
  return Result.match(result, {
    onSuccess: (value) =>
      Result.map(encodeWorkflowPayload(durableCodec(definition.success), value), (encoded) =>
        success(identity, encoded)
      ),
    onFailure: (error) =>
      Result.map(encodeWorkflowPayload(durableCodec(definition.failure), error), (encoded) =>
        failure(identity, encoded)
      )
  })
}

export const decodeStepResult = <Definition extends Step.Any>(
  definition: Definition,
  input: unknown
): Result.Result<
  Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>,
  DurableProtocolError
> => {
  const decoded = decodeEnvelope(input, identityOf(definition), () =>
    protocolError("InvalidDefinitionIdentity")
  )
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure)
  }
  return Match.valueTags(decoded.success, {
    Success: ({ value }) =>
      Result.map(decodeWorkflowPayload(durableCodec(definition.success), value), (decoded) =>
        Result.succeed(decoded as Step.Step.Success<Definition>)
      ),
    Failure: ({ error }) =>
      Result.map(decodeWorkflowPayload(durableCodec(definition.failure), error), (decoded) =>
        Result.fail(decoded as Step.Step.Failure<Definition>)
      ),
    InvalidInput: () => Result.fail(protocolError("InvalidOutcome"))
  })
}

export const encodeWorkflowResult = <Definition extends Workflow.Any>(
  definition: Definition,
  result: Result.Result<
    Workflow.Workflow.Success<Definition>,
    Workflow.Workflow.Failure<Definition>
  >
): Result.Result<DurableOutcome<DurableValue, DurableValue>, DurableProtocolError> => {
  const identity = identityOf(definition)
  return Result.match(result, {
    onSuccess: (value) =>
      Result.map(encodeWorkflowPayload(durableCodec(definition.success), value), (encoded) =>
        success(identity, encoded)
      ),
    onFailure: (error) =>
      Result.map(encodeWorkflowPayload(durableCodec(definition.failure), error), (encoded) =>
        failure(identity, encoded)
      )
  })
}

export const decodeWorkflowResult = <Definition extends Workflow.Any>(
  definition: Definition,
  executionId: string,
  input: unknown
): Result.Result<
  Result.Result<Workflow.Workflow.Success<Definition>, Workflow.Workflow.Failure<Definition>>,
  DefinitionConflict | DurableProtocolError | InvalidWorkflowInput
> => {
  const decoded = decodeEnvelope(input, identityOf(definition), (actual) =>
    actual.kind === "Workflow"
      ? new DefinitionConflict({
          executionId,
          expectedName: definition.name,
          expectedVersion: definition.version,
          actualName: actual.name,
          actualVersion: actual.version
        })
      : protocolError("InvalidDefinitionIdentity")
  )
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure)
  }
  return Match.valueTags(decoded.success, {
    Success: ({ value }) =>
      Result.map(decodeWorkflowPayload(durableCodec(definition.success), value), (decoded) =>
        Result.succeed(decoded as Workflow.Workflow.Success<Definition>)
      ),
    Failure: ({ error }) =>
      Result.map(decodeWorkflowPayload(durableCodec(definition.failure), error), (decoded) =>
        Result.fail(decoded as Workflow.Workflow.Failure<Definition>)
      ),
    InvalidInput: () => Result.fail(workflowInputError(definition.name, definition.version))
  })
}
