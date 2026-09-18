import type { Context as ResonateContext } from "@resonatehq/sdk/async"
import { Option, Result } from "effect"
import {
  DurableProtocolError,
  ExecutionRejected,
  InvalidDurableValue
} from "../CoreExecutionError.js"
import type { Type as DurableValue } from "../DurableValue.js"
import type * as Workflow from "../Workflow.js"
import * as DurableOutcome from "./DurableOutcome.js"
import * as DurableRejection from "./DurableRejection.js"
import { decodeWorkflowInput, durableCodec } from "./SchemaBoundary.js"
import * as WorkflowContextImpl from "./WorkflowContextImpl.js"

const rejection = <Definition extends Workflow.Any>(
  definition: Definition,
  executionId: string,
  cause: unknown
): DurableRejection.DurableExecutionRejected => {
  const durable = DurableRejection.decode(cause)
  if (Option.isSome(durable)) {
    return DurableRejection.encode(durable.value)
  }
  if (cause instanceof ExecutionRejected) {
    return DurableRejection.encode(cause)
  }
  return DurableRejection.make(
    definition,
    executionId,
    cause instanceof DurableProtocolError || cause instanceof InvalidDurableValue
      ? "ContractViolation"
      : "Defect"
  )
}

export const make = <Definition extends Workflow.Any>(
  definition: Definition,
  handler: Workflow.HandlerService<
    Workflow.Workflow.Input<Definition>,
    Workflow.Workflow.Success<Definition>,
    Workflow.Workflow.Failure<Definition>
  >
) => async (
  context: ResonateContext,
  ...arguments_: ReadonlyArray<unknown>
): Promise<DurableOutcome.DurableOutcome<DurableValue, DurableValue>> => {
  if (arguments_.length !== 1) {
    return DurableOutcome.invalidInput(DurableOutcome.identityOf(definition))
  }
  const input = decodeWorkflowInput(
    durableCodec(definition.input),
    arguments_[0],
    definition.name,
    definition.version
  )
  if (Result.isFailure(input)) {
    return DurableOutcome.invalidInput(DurableOutcome.identityOf(definition))
  }

  try {
    const result = await handler.execute(
      WorkflowContextImpl.make(context),
      input.success as Workflow.Workflow.Input<Definition>
    )
    if (!Result.isResult(result)) {
      throw DurableRejection.make(definition, context.id, "ContractViolation")
    }
    const encoded = DurableOutcome.encodeWorkflowResult(definition, result)
    if (Result.isFailure(encoded)) {
      throw DurableRejection.make(definition, context.id, "ContractViolation")
    }
    return encoded.success
  } catch (cause) {
    throw rejection(definition, context.id, cause)
  }
}
