import type {
  Context as ResonateContext,
  DurablePromise as ResonateDurablePromise
} from "@resonatehq/sdk/async"
import { Constant, Exponential, Linear, Never } from "@resonatehq/sdk/async"
import { Match, Option, Result } from "effect"
import type { Type as DurableValue } from "../DurableValue.js"
import type * as Step from "../Step.js"
import type {
  DurableCodec,
  DurablePromise,
  InvocationOptions,
  PromiseOptions,
  RetryPolicy,
  SleepOptions,
  WorkflowContext
} from "../WorkflowContext.js"
import * as DurableOutcome from "./DurableOutcome.js"
import * as DurableRejection from "./DurableRejection.js"
import {
  decodeDurableValue,
  decodeWorkflowPayload,
  durableCodec,
  encodeWorkflowPayload
} from "./SchemaBoundary.js"

const retryPolicy = (retry: RetryPolicy) => Match.valueTags(retry, {
  Never: () => new Never(),
  Constant: ({ delay, maxRetries }) => new Constant({ delay, maxRetries }),
  Linear: ({ delay, maxRetries }) => new Linear({ delay, maxRetries }),
  Exponential: ({ delay, factor, maxRetries, maxDelay }) =>
    new Exponential({ delay, factor, maxRetries, maxDelay })
})

const invocationOptions = (
  context: ResonateContext,
  version: number,
  options: InvocationOptions | undefined
) => context.options({
  version,
  ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
  ...(options?.target === undefined ? {} : { target: options.target }),
  ...(options?.tags === undefined ? {} : { tags: { ...options.tags } }),
  ...(options?.retry === undefined ? {} : { retryPolicy: retryPolicy(options.retry) })
})

const mapPromise = <Input, Output>(
  promise: ResonateDurablePromise<Input>,
  onSuccess: (value: Input) => Output
): DurablePromise<Output> => {
  const mapped = promise.then(
    onSuccess,
    (cause: unknown) => {
      const rejection = DurableRejection.decode(cause)
      if (Option.isSome(rejection)) {
        throw rejection.value
      }
      throw cause
    }
  )
  return Object.freeze({
    id: promise.id,
    then: mapped.then.bind(mapped),
    catch: mapped.catch.bind(mapped),
    finally: mapped.finally.bind(mapped),
    [Symbol.toStringTag]: "Promise"
  }) as DurablePromise<Output>
}

const rejectedPromise = <Value>(cause: unknown): DurablePromise<Value> => {
  const promise = Promise.reject(cause)
  return Object.freeze({
    id: "",
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: "Promise"
  }) as DurablePromise<Value>
}

const decodeStep = <
  Definition extends Step.Any
>(
  definition: Definition,
  value: unknown
): Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>> => {
  const decoded = DurableOutcome.decodeStepResult(definition, value)
  if (Result.isFailure(decoded)) {
    throw decoded.failure
  }
  return decoded.success
}

const sleepOptions = (options: SleepOptions): { readonly for?: number; readonly until?: Date } =>
  options.until === undefined ? { for: options.for } : { until: new Date(options.until) }

export const make = (context: ResonateContext): WorkflowContext => Object.freeze({
  id: context.id,
  parentId: context.parentId,
  originId: context.originId,
  branchId: context.branchId,
  timeoutAt: context.timeoutAt,
  attempt: context.attempt,
  version: context.version,
  name: context.func,

  run: <Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ) => {
    const encoded = encodeWorkflowPayload(durableCodec(step.input), input)
    return Result.isFailure(encoded)
      ? rejectedPromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>(encoded.failure)
      : mapPromise(
        context.run(
          step.name,
          encoded.success,
          invocationOptions(context, step.version, options)
        ),
        (value) => decodeStep(step, value)
      )
  },

  rpc: <Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ) => {
    const encoded = encodeWorkflowPayload(durableCodec(step.input), input)
    return Result.isFailure(encoded)
      ? rejectedPromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>(encoded.failure)
      : mapPromise(
        context.rpc(
          step.name,
          encoded.success,
          invocationOptions(context, step.version, options)
        ),
        (value) => decodeStep(step, value)
      )
  },

  sleep: (duration: number | SleepOptions) =>
    typeof duration === "number" ? context.sleep(duration) : context.sleep(sleepOptions(duration)),

  promise: <Value, Encoded extends DurableValue>(
    schema: DurableCodec<Value, Encoded>,
    options?: PromiseOptions
  ) => {
    const data = options?.data === undefined
      ? Result.succeed(undefined)
      : decodeDurableValue(options.data, "PromiseData")
    if (Result.isFailure(data)) {
      return rejectedPromise<Value>(data.failure)
    }
    return mapPromise(
      context.promise<unknown>({
        ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
        ...(data.success === undefined ? {} : { data: data.success }),
        ...(options?.tags === undefined ? {} : { tags: { ...options.tags } })
      }),
      (value) => {
        const decoded = decodeWorkflowPayload(schema, value)
        if (Result.isFailure(decoded)) {
          throw decoded.failure
        }
        return decoded.success
      }
    )
  },

  date: Object.freeze({
    now: () => context.date.now()
  }),

  math: Object.freeze({
    random: () => context.math.random()
  })
})
