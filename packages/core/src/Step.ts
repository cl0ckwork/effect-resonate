import { Context, Effect, Layer, Schema } from "effect"
import type { Type as DurableValue } from "./DurableValue.js"
import { StepContext, type StepContextService } from "./StepContext.js"

const TypeId: unique symbol = Symbol.for("@effect-resonate/core/Step")
const HandlerTypeId: unique symbol = Symbol.for("@effect-resonate/core/Step/Handler")

/** A service-free codec whose encoded representation can cross a durable boundary. */
export type StepCodec<Value, Encoded extends DurableValue = DurableValue> = Schema.Codec<
  Value,
  Encoded,
  never,
  never
>

/** Type-level identity for the implementation required by a step contract. */
export interface Handler<Definition extends Any> {
  readonly [HandlerTypeId]: Definition
}

export interface HandlerService<Input, Success, Failure> {
  readonly execute: (input: Input, context: StepContextService) => Effect.Effect<Success, Failure>
}

/** An inert, versioned durable step contract. */
export interface Step<
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
  readonly kind: "Step"
  readonly name: Name
  readonly version: Version
  readonly input: StepCodec<Input, InputEncoded>
  readonly success: StepCodec<Success, SuccessEncoded>
  readonly failure: StepCodec<Failure, FailureEncoded>
  readonly handler: Context.Service<Handler<this>, HandlerService<Input, Success, Failure>>
  /** The immediately preceding contract when this definition was created with `evolve`. */
  readonly previous: Previous

  /** Supplies this contract's Effect implementation and captures its Layer requirements. */
  readonly toLayer: <Requirements>(
    execute: (input: Input) => Effect.Effect<Success, Failure, Requirements>
  ) => Layer.Layer<Handler<this>, never, Exclude<Requirements, StepContext>>
}

/** Type-erased step shape used by definition collections. */
export interface Any {
  readonly [TypeId]: typeof TypeId
  readonly kind: "Step"
  readonly name: string
  readonly version: number
  readonly input: Schema.Top
  readonly success: Schema.Top
  readonly failure: Schema.Top
  readonly handler: Context.Key<unknown, unknown>
  readonly previous: Any | undefined
}

export declare namespace Step {
  export type Name<Definition> =
    Definition extends Step<
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
    Definition extends Step<
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
    Definition extends Step<
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
    Definition extends Step<
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
    Definition extends Step<
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
  readonly input: StepCodec<Input, InputEncoded>
  readonly success: StepCodec<Success, SuccessEncoded>
  readonly failure: StepCodec<Failure, FailureEncoded>
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
  readonly input: StepCodec<Input, InputEncoded>
  readonly success: StepCodec<Success, SuccessEncoded>
  readonly failure: StepCodec<Failure, FailureEncoded>
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
): Step<
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
  type Definition = Step<
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
    `@effect-resonate/core/Step/Handler/${options.name}@${options.version}`
  )

  const definition = {
    [TypeId]: TypeId as typeof TypeId,
    kind: "Step" as const,
    name: options.name,
    version: options.version,
    input: options.input,
    success: options.success,
    failure: options.failure,
    handler,
    previous,
    toLayer: <Requirements>(
      execute: (input: Input) => Effect.Effect<Success, Failure, Requirements>
    ): Layer.Layer<Implementation, never, Exclude<Requirements, StepContext>> =>
      Layer.effect(
        handler,
        Effect.context<Exclude<Requirements, StepContext>>().pipe(
          Effect.map((services) => ({
            execute: (input: Input, context: StepContextService) =>
              Effect.suspend(() => execute(input)).pipe(
                Effect.provide(Context.add(services, StepContext, context))
              ) as Effect.Effect<Success, Failure>
          }))
        )
      )
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
): Step<
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

/** Creates a new step contract version while preserving its stable Resonate name. */
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
): Step<
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
