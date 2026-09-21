import type {
  Context as ResonateContext,
  DetachedHandle as ResonateDetachedHandle,
  DurablePromise as ResonateDurablePromise,
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

interface TypedRun {
  <Definition extends Step.Any>(
    step: Definition,
    input: Step.Step.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<Result.Result<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>>
}

interface TypedDetached {
  <Definition extends Workflow.Any>(
    workflow: Definition,
    input: Workflow.Workflow.Input<Definition>,
    options?: InvocationOptions
  ): DurablePromise<DetachedHandle>
}

interface TypedPromise {
  <Value, Encoded extends DurableValue>(
    schema: DurableCodec<Value, Encoded>,
    options?: PromiseOptions
  ): DurablePromise<Value>
}

/**
 * Resonate's eager async Context with additive schema-aware definition overloads.
 * Durable operations intentionally remain eager DurablePromises, not lazy Effects.
 */
export interface WorkflowContext extends Omit<
  ResonateContext,
  "run" | "rpc" | "detached" | "promise"
> {
  readonly run: ResonateContext["run"] & TypedRun
  readonly rpc: ResonateContext["rpc"] & TypedRun
  readonly detached: ResonateContext["detached"] & TypedDetached
  readonly promise: ResonateContext["promise"] & TypedPromise
}
