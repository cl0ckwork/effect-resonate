import type {
  AnyFunc,
  Context as ResonateContext,
  DetachedHandle as ResonateDetachedHandle,
  DurablePromise as ResonateDurablePromise,
  Info,
  RetryPolicy as ResonateRetryPolicy
} from "@resonatehq/sdk/async"
import type { Result, Schema } from "effect"
import type { Type as DurableValue } from "./DurableValue.js"
import type * as Step from "./Step.js"
import type * as Workflow from "./Workflow.js"

export type DurablePromise<Value> = ResonateDurablePromise<Value>
export type DetachedHandle = ResonateDetachedHandle
export type RetryPolicy = ResonateRetryPolicy

type ContextOptions = NonNullable<Parameters<ResonateContext["options"]>[0]>
type RawPromiseOptions = NonNullable<Parameters<ResonateContext["promise"]>[0]>

/** Upstream invocation options, with the exact contract version supplied by a definition. */
export type InvocationOptions = Omit<ContextOptions, "version">
export type SleepOptions = Exclude<Parameters<ResonateContext["sleep"]>[0], number>
export type PromiseOptions = RawPromiseOptions

export type DurableCodec<Value, Encoded extends DurableValue = DurableValue> = Schema.Codec<
  Value,
  Encoded,
  never,
  never
>

type Params<Func extends AnyFunc> = Func extends (
  context: infer _Context,
  ...arguments_: infer Arguments
) => unknown ? Arguments : never

type ParamsWithOptions<Func extends AnyFunc> = [...Params<Func>, ReturnType<ResonateContext["options"]>?]
type Return<Func extends AnyFunc> = Awaited<ReturnType<Func>>

/**
 * Resonate's eager async Context with additive schema-aware definition overloads.
 * Durable operations intentionally remain eager DurablePromises, not lazy Effects.
 */
export interface WorkflowContext extends Info {
  run<Func extends AnyFunc>(
    func: Func,
    ...arguments_: ParamsWithOptions<Func>
  ): DurablePromise<Return<Func>>
  run<Value>(func: string, ...arguments_: ReadonlyArray<unknown>): DurablePromise<Value>
  run<Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>

  rpc<Func extends AnyFunc>(
    func: Func,
    ...arguments_: ParamsWithOptions<Func>
  ): DurablePromise<Return<Func>>
  rpc<Value>(func: string, ...arguments_: ReadonlyArray<unknown>): DurablePromise<Value>
  rpc<Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>

  detached<Func extends AnyFunc>(
    func: Func,
    ...arguments_: ParamsWithOptions<Func>
  ): DurablePromise<DetachedHandle>
  detached(func: string, ...arguments_: ReadonlyArray<unknown>): DurablePromise<DetachedHandle>
  detached<Definition extends Workflow.Any>(
    workflow: Definition,
    input: Workflow.Workflow.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<DetachedHandle>

  promise<Value>(options?: PromiseOptions): DurablePromise<Value>
  promise<Value, Encoded extends DurableValue>(
    schema: DurableCodec<Value, Encoded>,
    options?: PromiseOptions
  ): DurablePromise<Value>

  sleep(duration: number): DurablePromise<void>
  sleep(options: SleepOptions): DurablePromise<void>

  options(options?: ContextOptions): ReturnType<ResonateContext["options"]>
  panic(condition: boolean, message?: string): void
  assert(condition: boolean, message?: string): void

  readonly date: ResonateContext["date"]
  readonly math: ResonateContext["math"]
}
