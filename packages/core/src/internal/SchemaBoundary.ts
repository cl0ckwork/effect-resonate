import { Result, Schema } from "effect"
import type {
  DurableProtocolError,
  InvalidDurableValue,
  InvalidWorkflowInput
} from "../CoreExecutionError.js"
import type { Type as DurableValue } from "../DurableValue.js"
import { schema as DurableValueSchema } from "../DurableValue.js"
import type { WorkflowCodec } from "../Workflow.js"
import { durableValueError, protocolError, workflowInputError } from "./Redaction.js"

const strict = { onExcessProperty: "error" } as const

/** Erases a codec after public definition constructors have enforced its durable encoded form. */
export const durableCodec = (
  schema: Schema.Top
): Schema.Codec<unknown, DurableValue, never, never> =>
  schema as Schema.Codec<unknown, DurableValue, never, never>

const parse = <A, E>(evaluate: () => Result.Result<A, unknown>, error: E): Result.Result<A, E> =>
  Result.flatMap(
    Result.try({
      try: evaluate,
      catch: () => error
    }),
    Result.mapError(() => error)
  )

export const decodeSchema = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  issue: DurableProtocolError["issue"],
  options: { readonly onExcessProperty?: "ignore" | "error" } = strict
): Result.Result<A, DurableProtocolError> => {
  const error = protocolError(issue)
  return parse(() => Schema.decodeUnknownResult(schema, options)(input), error)
}

export const decodeDurableValue = (
  input: unknown,
  location: InvalidDurableValue["location"]
): Result.Result<DurableValue, InvalidDurableValue> => {
  const error = durableValueError(location)
  return parse(() => Schema.decodeUnknownResult(DurableValueSchema, strict)(input), error)
}

export const decodeWorkflowInput = <A, Encoded extends DurableValue>(
  codec: WorkflowCodec<A, Encoded>,
  input: unknown,
  workflowName: string,
  workflowVersion: number
): Result.Result<A, InvalidWorkflowInput> => {
  const error = workflowInputError(workflowName, workflowVersion)
  return Result.flatMap(
    parse(() => Schema.decodeUnknownResult(DurableValueSchema, strict)(input), error),
    (value) => parse(() => Schema.decodeUnknownResult(codec, strict)(value), error)
  )
}

export const encodeWorkflowInput = <A, Encoded extends DurableValue>(
  codec: WorkflowCodec<A, Encoded>,
  input: A,
  workflowName: string,
  workflowVersion: number
): Result.Result<Encoded, InvalidWorkflowInput> => {
  const error = workflowInputError(workflowName, workflowVersion)
  return Result.flatMap(
    parse(() => Schema.encodeResult(codec, strict)(input), error),
    (encoded) =>
      Result.map(
        parse(() => Schema.decodeUnknownResult(DurableValueSchema, strict)(encoded), error),
        () => encoded
      )
  )
}

export const decodeWorkflowPayload = <A, Encoded extends DurableValue>(
  codec: WorkflowCodec<A, Encoded>,
  input: unknown
): Result.Result<A, DurableProtocolError> => {
  const error = protocolError("PayloadDecodeFailed")
  return Result.flatMap(
    parse(() => Schema.decodeUnknownResult(DurableValueSchema, strict)(input), error),
    (value) => parse(() => Schema.decodeUnknownResult(codec, strict)(value), error)
  )
}

export const encodeWorkflowPayload = <A, Encoded extends DurableValue>(
  codec: WorkflowCodec<A, Encoded>,
  value: A
): Result.Result<Encoded, DurableProtocolError> => {
  const error = protocolError("PayloadEncodeFailed")
  return Result.flatMap(
    parse(() => Schema.encodeResult(codec, strict)(value), error),
    (encoded) =>
      Result.map(
        parse(() => Schema.decodeUnknownResult(DurableValueSchema, strict)(encoded), error),
        () => encoded
      )
  )
}
