import {
  DurableProtocolError,
  InvalidDurableValue,
  InvalidWorkflowInput
} from "../CoreExecutionError.js"

/** Creates an allowlisted protocol error without retaining parser input or issues. */
export const protocolError = (
  issue: DurableProtocolError["issue"]
): DurableProtocolError => new DurableProtocolError({ issue })

/** Creates a workflow-input error without retaining the input or schema issue. */
export const workflowInputError = (
  workflowName: string,
  workflowVersion: number
): InvalidWorkflowInput =>
  new InvalidWorkflowInput({
    workflowName,
    workflowVersion,
    issue: "SchemaMismatch"
  })

/** Creates a durable-value error without retaining the rejected value. */
export const durableValueError = (
  location: InvalidDurableValue["location"]
): InvalidDurableValue =>
  new InvalidDurableValue({
    location,
    issue: "NotJsonCompatible"
  })
