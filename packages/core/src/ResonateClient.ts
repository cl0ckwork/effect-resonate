import { Context, type Duration, Effect, Layer, type Schema } from "effect"
import type {
  DefinitionConflict,
  DurableProtocolError,
  ExecutionRejected,
  InvalidClientConfiguration,
  InvalidDefinition,
  InvalidDurableValue,
  InvalidWorkflowInput,
  DuplicateDefinition,
  ResonateSdkError
} from "./CoreExecutionError.js"
import type { Type as DurableValue } from "./DurableValue.js"
import type * as ResonateFunctions from "./ResonateFunctions.js"
import { ResonateNetwork } from "./ResonateNetwork.js"
import type { InvocationOptions } from "./WorkflowContext.js"
import type * as Workflow from "./Workflow.js"
import { AdapterSupervisor } from "./internal/AdapterSupervisor.js"
import * as ClientLive from "./internal/ClientLive.js"

export type InvocationError<Definition extends Workflow.Any> =
  | Workflow.Workflow.Failure<Definition>
  | InvalidWorkflowInput
  | DefinitionConflict
  | DurableProtocolError
  | ExecutionRejected
  | ResonateSdkError

export interface RunRequest<Definition extends Workflow.Any> {
  readonly workflow: Definition
  readonly id: string
  readonly input: Workflow.Workflow.Input<Definition>
  readonly options?: InvocationOptions
}

export interface AttachRequest<Definition extends Workflow.Any> {
  readonly workflow: Definition
  readonly id: string
}

export interface ResolvePromiseRequest<Value, Encoded extends DurableValue> {
  readonly id: string
  readonly schema: Schema.Codec<Value, Encoded, never, never>
  readonly value: Value
}

export interface SettlePromiseRequest {
  readonly id: string
  readonly reason?: DurableValue
}

export interface ResonateClientService {
  readonly run: <Definition extends Workflow.Any>(request: RunRequest<Definition>) =>
    Effect.Effect<Workflow.Workflow.Success<Definition>, InvocationError<Definition>>

  readonly attach: <Definition extends Workflow.Any>(request: AttachRequest<Definition>) =>
    Effect.Effect<Workflow.Workflow.Success<Definition>, InvocationError<Definition>>

  readonly resolvePromise: <Value, Encoded extends DurableValue>(request: ResolvePromiseRequest<Value, Encoded>) =>
    Effect.Effect<void, DurableProtocolError | ResonateSdkError>

  readonly rejectPromise: (request: SettlePromiseRequest) =>
    Effect.Effect<void, InvalidDurableValue | ResonateSdkError>

  readonly cancelPromise: (request: SettlePromiseRequest) =>
    Effect.Effect<void, InvalidDurableValue | ResonateSdkError>
}

export interface LayerOptions<Group extends ResonateFunctions.Any> {
  readonly functions: Group
  readonly drainTimeout: Duration.Input
}

/** Effect-facing access to durable workflow execution and external promises. */
export class ResonateClient extends Context.Service<ResonateClient, ResonateClientService>()(
  "@effect-resonate/core/ResonateClient"
) {}

export type AcquisitionError =
  | InvalidDefinition
  | DuplicateDefinition
  | InvalidClientConfiguration
  | ResonateSdkError

/** Acquires one ready Resonate runtime for a closed function group. */
export const layer = <Group extends ResonateFunctions.Any>(
  options: LayerOptions<Group>
): Layer.Layer<
  ResonateClient,
  AcquisitionError,
  ResonateNetwork | ResonateFunctions.Handlers<Group>
> => Layer.effect(ResonateClient, ClientLive.make(options.functions, options)).pipe(
  Layer.provide(AdapterSupervisor.layer)
)
