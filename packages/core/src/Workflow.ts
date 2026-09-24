import { Context, Layer, type Result, type Schema } from "effect"
import type { Type as DurableValue } from "./DurableValue.js"
import type { WorkflowContext } from "./WorkflowContext.js"

const TypeId: unique symbol = Symbol.for("@effect-resonate/core/Workflow")
const HandlerTypeId: unique symbol = Symbol.for("@effect-resonate/core/Workflow/Handler")

export type WorkflowCodec<Value, Encoded extends DurableValue = DurableValue> = Schema.Codec<
  Value,
  Encoded,
  never,
  never
>

export interface Handler<Definition extends Any> {
  readonly [HandlerTypeId]: Definition
}

export interface HandlerService<Input, Success, Failure> {
  readonly execute: (
    context: WorkflowContext,
    input: Input
  ) => Promise<Result.Result<Success, Failure>>
}

/** An inert, versioned durable workflow contract. */
export interface Workflow<
  Name extends string,
  Version extends number,
  Input,
  InputEncoded extends DurableValue,
  Success,
  SuccessEncoded extends DurableValue,
  Failure,
  FailureEncoded extends DurableValue,
  Previous extends Any | undefined = Any | undefined
> {
  readonly [TypeId]: typeof TypeId
  readonly kind: "Workflow"
  readonly name: Name
  readonly version: Version
  readonly input: WorkflowCodec<Input, InputEncoded>
  readonly success: WorkflowCodec<Success, SuccessEncoded>
  readonly failure: WorkflowCodec<Failure, FailureEncoded>
  readonly handler: Context.Service<Handler<this>, HandlerService<Input, Success, Failure>>
  /** The immediately preceding contract when this definition was created with `evolve`. */
  readonly previous: Previous

  /** Supplies this contract's Resonate async workflow implementation. */
  readonly toLayer: (
    execute: HandlerService<Input, Success, Failure>["execute"]
  ) => Layer.Layer<Handler<this>>
}

/** Type-erased workflow shape used by definition collections. */
export interface Any {
  readonly [TypeId]: typeof TypeId
  readonly kind: "Workflow"
  readonly name: string
  readonly version: number
  readonly input: Schema.Top
  readonly success: Schema.Top
  readonly failure: Schema.Top
  readonly handler: Context.Key<unknown, unknown>
  readonly previous: Any | undefined
}

export declare namespace Workflow {
  export type Name<Definition> =
    Definition extends Workflow<
      infer Name,
      infer _Version,
      infer _Input,
      infer _InputEncoded,
      infer _Success,
      infer _SuccessEncoded,
      infer _Failure,
      infer _FailureEncoded,
      infer _Previous
    >
      ? Name
      : never
  export type Version<Definition> =
    Definition extends Workflow<
      infer _Name,
      infer Version,
      infer _Input,
      infer _InputEncoded,
      infer _Success,
      infer _SuccessEncoded,
      infer _Failure,
      infer _FailureEncoded,
      infer _Previous
    >
      ? Version
      : never
  export type Input<Definition> =
    Definition extends Workflow<
      infer _Name,
      infer _Version,
      infer Input,
      infer _InputEncoded,
      infer _Success,
      infer _SuccessEncoded,
      infer _Failure,
      infer _FailureEncoded,
      infer _Previous
    >
      ? Input
      : never
  export type Success<Definition> =
    Definition extends Workflow<
      infer _Name,
      infer _Version,
      infer _Input,
      infer _InputEncoded,
      infer Success,
      infer _SuccessEncoded,
      infer _Failure,
      infer _FailureEncoded,
      infer _Previous
    >
      ? Success
      : never
  export type Failure<Definition> =
    Definition extends Workflow<
      infer _Name,
      infer _Version,
      infer _Input,
      infer _InputEncoded,
      infer _Success,
      infer _SuccessEncoded,
      infer Failure,
      infer _FailureEncoded,
      infer _Previous
    >
      ? Failure
      : never
  export type Implementation<Definition extends Any> = Handler<Definition>
}

export interface MakeOptions<
  Name extends string,
  Version extends number,
  Input,
  InputEncoded extends DurableValue,
  Success,
  SuccessEncoded extends DurableValue,
  Failure,
  FailureEncoded extends DurableValue
> {
  readonly name: Name
  readonly version: Version
  readonly input: WorkflowCodec<Input, InputEncoded>
  readonly success: WorkflowCodec<Success, SuccessEncoded>
  readonly failure: WorkflowCodec<Failure, FailureEncoded>
}

export interface EvolveOptions<
  Version extends number,
  Input,
  InputEncoded extends DurableValue,
  Success,
  SuccessEncoded extends DurableValue,
  Failure,
  FailureEncoded extends DurableValue
> {
  readonly version: Version
  readonly input: WorkflowCodec<Input, InputEncoded>
  readonly success: WorkflowCodec<Success, SuccessEncoded>
  readonly failure: WorkflowCodec<Failure, FailureEncoded>
}

const makeDefinition = <
  const Name extends string,
  const Version extends number,
  Input,
  InputEncoded extends DurableValue,
  Success,
  SuccessEncoded extends DurableValue,
  Failure,
  FailureEncoded extends DurableValue,
  Previous extends Any | undefined
>(
  options: MakeOptions<
    Name,
    Version,
    Input,
    InputEncoded,
    Success,
    SuccessEncoded,
    Failure,
    FailureEncoded
  >,
  previous: Previous
): Workflow<
  Name,
  Version,
  Input,
  InputEncoded,
  Success,
  SuccessEncoded,
  Failure,
  FailureEncoded,
  Previous
> => {
  type Definition = Workflow<
    Name,
    Version,
    Input,
    InputEncoded,
    Success,
    SuccessEncoded,
    Failure,
    FailureEncoded,
    Previous
  >
  type Implementation = Handler<Definition>

  const handler = Context.Service<Implementation, HandlerService<Input, Success, Failure>>(
    `@effect-resonate/core/Workflow/Handler/${options.name}@${options.version}`
  )

  const definition = {
    [TypeId]: TypeId as typeof TypeId,
    kind: "Workflow" as const,
    name: options.name,
    version: options.version,
    input: options.input,
    success: options.success,
    failure: options.failure,
    handler,
    previous,
    toLayer: (
      execute: HandlerService<Input, Success, Failure>["execute"]
    ): Layer.Layer<Implementation> => Layer.succeed(handler, { execute })
  }

  return Object.freeze(definition) as Definition
}

export const make = <
  const Name extends string,
  const Version extends number,
  Input,
  InputEncoded extends DurableValue,
  Success,
  SuccessEncoded extends DurableValue,
  Failure,
  FailureEncoded extends DurableValue
>(
  options: MakeOptions<
    Name,
    Version,
    Input,
    InputEncoded,
    Success,
    SuccessEncoded,
    Failure,
    FailureEncoded
  >
): Workflow<
  Name,
  Version,
  Input,
  InputEncoded,
  Success,
  SuccessEncoded,
  Failure,
  FailureEncoded,
  undefined
> => {
  return makeDefinition(options, undefined)
}

/** Creates a new workflow contract version while preserving its stable Resonate name. */
export const evolve = <
  const Definition extends Any,
  const Version extends number,
  Input,
  InputEncoded extends DurableValue,
  Success,
  SuccessEncoded extends DurableValue,
  Failure,
  FailureEncoded extends DurableValue
>(
  previous: Definition,
  options: EvolveOptions<
    Version,
    Input,
    InputEncoded,
    Success,
    SuccessEncoded,
    Failure,
    FailureEncoded
  >
): Workflow<
  Definition["name"],
  Version,
  Input,
  InputEncoded,
  Success,
  SuccessEncoded,
  Failure,
  FailureEncoded,
  Definition
> => makeDefinition({ ...options, name: previous.name }, previous)
