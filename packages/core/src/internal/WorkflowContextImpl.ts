import {
  DurablePromise as ResonateDurablePromise,
  type AnyFunc,
  type Context as ResonateContext,
  type Info
} from "@resonatehq/sdk/async"
import { Option, Predicate, Result, Schema } from "effect"
import type { Type as DurableValue } from "../DurableValue.js"
import type * as Step from "../Step.js"
import type * as Workflow from "../Workflow.js"
import type {
  DurableCodec,
  DurablePromise,
  InvocationOptions,
  PromiseOptions,
  WorkflowContext
} from "../WorkflowContext.js"
import * as DurableOutcome from "./DurableOutcome.js"
import * as DurableRejection from "./DurableRejection.js"
import {
  decodeWorkflowPayload,
  durableCodec,
  encodeWorkflowPayload
} from "./SchemaBoundary.js"

const invocationOptions = (
  context: ResonateContext,
  version: number,
  options: InvocationOptions | undefined
) => context.options({ ...options, version })

const mapPromise = <Input, Output>(
  promise: ResonateDurablePromise<Input>,
  onSuccess: (value: Input) => Output
): DurablePromise<Output> => new ResonateDurablePromise(
  promise.id,
  promise.then(
    onSuccess,
    (cause: unknown) => {
      const rejection = DurableRejection.decode(cause)
      if (Option.isSome(rejection)) {
        throw rejection.value
      }
      throw cause
    }
  )
)

const rejectedPromise = <Value>(cause: unknown): DurablePromise<Value> =>
  new ResonateDurablePromise("", Promise.reject(cause))

const decodeStep = <Definition extends Step.Any>(
  definition: Definition,
  value: unknown
): Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>> => {
  const decoded = DurableOutcome.decodeStepResult(definition, value)
  if (Result.isFailure(decoded)) {
    throw decoded.failure
  }
  return decoded.success
}

const runStep = <Definition extends Step.Any>(
  context: ResonateContext,
  definition: Definition,
  input: Step.Step.Input<Definition>,
  options: InvocationOptions | undefined
): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>> => {
  const encoded = encodeWorkflowPayload(durableCodec(definition.input), input)
  return Result.isFailure(encoded)
    ? rejectedPromise(encoded.failure)
    : mapPromise(
      context.run(
        definition.name,
        encoded.success,
        invocationOptions(context, definition.version, options)
      ),
      (value) => decodeStep(definition, value)
    )
}

const rpcStep = <Definition extends Step.Any>(
  context: ResonateContext,
  definition: Definition,
  input: Step.Step.Input<Definition>,
  options: InvocationOptions | undefined
): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>> => {
  const encoded = encodeWorkflowPayload(durableCodec(definition.input), input)
  return Result.isFailure(encoded)
    ? rejectedPromise(encoded.failure)
    : mapPromise(
      context.rpc(
        definition.name,
        encoded.success,
        invocationOptions(context, definition.version, options)
      ),
      (value) => decodeStep(definition, value)
    )
}

const detachedWorkflow = <Definition extends Workflow.Any>(
  context: ResonateContext,
  definition: Definition,
  input: Workflow.Workflow.Input<Definition>,
  options: InvocationOptions | undefined
): DurablePromise<import("@resonatehq/sdk/async").DetachedHandle> => {
  const encoded = encodeWorkflowPayload(durableCodec(definition.input), input)
  return Result.isFailure(encoded)
    ? rejectedPromise(encoded.failure)
    : context.detached(
      definition.name,
      encoded.success,
      invocationOptions(context, definition.version, options)
    )
}

const typedPromise = <Value, Encoded extends DurableValue>(
  context: ResonateContext,
  schema: DurableCodec<Value, Encoded>,
  options: PromiseOptions | undefined
): DurablePromise<Value> => mapPromise(
  context.promise<unknown>(options),
  (value) => {
    const decoded = decodeWorkflowPayload(schema, value)
    if (Result.isFailure(decoded)) {
      throw decoded.failure
    }
    return decoded.success
  }
)

const rawRun = (
  context: ResonateContext,
  func: AnyFunc | string,
  arguments_: ReadonlyArray<unknown>
): DurablePromise<unknown> => Predicate.isString(func)
  ? context.run<unknown>(func, ...arguments_)
  : context.run(func, ...arguments_)

const rawRpc = (
  context: ResonateContext,
  func: AnyFunc | string,
  arguments_: ReadonlyArray<unknown>
): DurablePromise<unknown> => Predicate.isString(func)
  ? context.rpc<unknown>(func, ...arguments_)
  : context.rpc(func, ...arguments_)

const rawDetached = (
  context: ResonateContext,
  func: AnyFunc | string,
  arguments_: ReadonlyArray<unknown>
) => Predicate.isString(func)
  ? context.detached(func, ...arguments_)
  : context.detached(func, ...arguments_)

export const make = (context: ResonateContext): WorkflowContext => {
  const run = ((
    funcOrDefinition: AnyFunc | string | Step.Any,
    ...arguments_: ReadonlyArray<unknown>
  ) => Predicate.isString(funcOrDefinition) || Predicate.isFunction(funcOrDefinition)
    ? rawRun(context, funcOrDefinition as AnyFunc | string, arguments_)
    : runStep(
      context,
      funcOrDefinition,
      arguments_[0] as never,
      arguments_[1] as InvocationOptions | undefined
    )) as WorkflowContext["run"]

  const rpc = ((
    funcOrDefinition: AnyFunc | string | Step.Any,
    ...arguments_: ReadonlyArray<unknown>
  ) => Predicate.isString(funcOrDefinition) || Predicate.isFunction(funcOrDefinition)
    ? rawRpc(context, funcOrDefinition as AnyFunc | string, arguments_)
    : rpcStep(
      context,
      funcOrDefinition,
      arguments_[0] as never,
      arguments_[1] as InvocationOptions | undefined
    )) as WorkflowContext["rpc"]

  const detached = ((
    funcOrDefinition: AnyFunc | string | Workflow.Any,
    ...arguments_: ReadonlyArray<unknown>
  ) => Predicate.isString(funcOrDefinition) || Predicate.isFunction(funcOrDefinition)
    ? rawDetached(context, funcOrDefinition as AnyFunc | string, arguments_)
    : detachedWorkflow(
      context,
      funcOrDefinition,
      arguments_[0] as never,
      arguments_[1] as InvocationOptions | undefined
    )) as WorkflowContext["detached"]

  const promise = ((
    schemaOrOptions?: Schema.Top | PromiseOptions,
    options?: PromiseOptions
  ) => Schema.isSchema(schemaOrOptions)
    ? typedPromise(context, schemaOrOptions as DurableCodec<unknown>, options)
    : context.promise(schemaOrOptions)) as WorkflowContext["promise"]

  const getDependency: Info["getDependency"] = <Value>(key: string) =>
    context.getDependency<Value>(key)

  return Object.freeze({
    id: context.id,
    parentId: context.parentId,
    originId: context.originId,
    branchId: context.branchId,
    timeoutAt: context.timeoutAt,
    attempt: context.attempt,
    version: context.version,
    func: context.func,
    getDependency,
    run,
    rpc,
    detached,
    promise,
    sleep: (duration: number | Parameters<ResonateContext["sleep"]>[0]) => context.sleep(duration),
    options: (options?: Parameters<ResonateContext["options"]>[0]) => context.options(options),
    panic: (condition: boolean, message?: string) => context.panic(condition, message),
    assert: (condition: boolean, message?: string) => context.assert(condition, message),
    date: context.date,
    math: context.math
  })
}
