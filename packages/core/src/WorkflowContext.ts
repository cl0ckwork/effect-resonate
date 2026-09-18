import type { Result, Schema } from "effect"
import type { Type as DurableValue } from "./DurableValue.js"
import type * as Step from "./Step.js"

/** SDK-free shape of an eager, replay-aware Resonate operation. */
export interface DurablePromise<out Value> extends Promise<Value> {
  readonly id: string
}

export type RetryPolicy =
  | { readonly _tag: "Never" }
  | { readonly _tag: "Constant"; readonly delay: number; readonly maxRetries: number }
  | { readonly _tag: "Linear"; readonly delay: number; readonly maxRetries: number }
  | {
    readonly _tag: "Exponential"
    readonly delay: number
    readonly factor: number
    readonly maxRetries: number
    readonly maxDelay: number
  }

/** Options visible at each child invocation; definition versions are always supplied by the wrapper. */
export interface InvocationOptions {
  readonly timeout?: number
  readonly target?: string
  readonly tags?: Readonly<Record<string, string>>
  readonly retry?: RetryPolicy
}

export type SleepOptions =
  | { readonly for: number; readonly until?: never }
  | { readonly until: number; readonly for?: never }

export interface PromiseOptions {
  readonly timeout?: number
  readonly data?: DurableValue
  readonly tags?: Readonly<Record<string, string>>
}

export type DurableCodec<Value, Encoded extends DurableValue = DurableValue> = Schema.Codec<
  Value,
  Encoded,
  never,
  never
>

/** Durable orchestration surface passed to workflow bodies. */
export interface WorkflowContext {
  readonly id: string
  readonly parentId: string
  readonly originId: string
  readonly branchId: string
  readonly timeoutAt: number
  readonly attempt: number
  readonly version: number
  readonly name: string

  run<Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>

  rpc<Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>

  sleep(duration: number | SleepOptions): DurablePromise<void>

  promise<Value, Encoded extends DurableValue>(
    schema: DurableCodec<Value, Encoded>,
    options?: PromiseOptions
  ): DurablePromise<Value>

  readonly date: {
    readonly now: () => DurablePromise<number>
  }

  readonly math: {
    readonly random: () => DurablePromise<number>
  }
}
