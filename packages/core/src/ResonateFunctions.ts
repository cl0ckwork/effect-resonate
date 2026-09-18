import type * as Step from "./Step.js"
import type * as Workflow from "./Workflow.js"

const TypeId = "@effect-resonate/core/ResonateFunctions"

export type AnyFunction = Step.Any | Workflow.Any

/** A closed, immutable collection of Resonate functions. */
export interface ResonateFunctions<in out Function extends AnyFunction> {
  // Matches the class-style constructor shape used by Effect's RpcGroup.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  new(_: never): {}

  readonly [TypeId]: typeof TypeId
  readonly functions: ReadonlyArray<Function>

  add<const Added extends ReadonlyArray<AnyFunction>>(
    ...functions: Added
  ): ResonateFunctions<Function | Added[number]>

  merge<const Groups extends ReadonlyArray<Any>>(
    ...groups: Groups
  ): ResonateFunctions<Function | Functions<Groups[number]>>
}

/** Type-erased function collection. */
export interface Any {
  readonly [TypeId]: typeof TypeId
  readonly functions: ReadonlyArray<AnyFunction>
}

/** Extracts the function union retained by a collection. */
export type Functions<Group> = Group extends ResonateFunctions<infer Function> ? Function : never

/** Extracts the step union retained by a collection. */
export type Steps<Group> = Extract<Functions<Group>, Step.Any>

/** Extracts the workflow union retained by a collection. */
export type Workflows<Group> = Extract<Functions<Group>, Workflow.Any>

/** Computes the implementation services required by the collection. */
export type Handlers<Group> =
  | Step.Step.Implementation<Steps<Group>>
  | Workflow.Workflow.Implementation<Workflows<Group>>

const Proto = {
  [TypeId]: TypeId,
  add(this: ResonateFunctions<AnyFunction>, ...functions: ReadonlyArray<AnyFunction>) {
    return makeProto([...this.functions, ...functions])
  },
  merge(this: ResonateFunctions<AnyFunction>, ...groups: ReadonlyArray<Any>) {
    return makeProto([
      ...this.functions,
      ...groups.flatMap((group) => group.functions)
    ])
  }
}

const makeProto = <Function extends AnyFunction>(
  functions: ReadonlyArray<Function>
): ResonateFunctions<Function> =>
  Object.assign(function() {}, Proto, {
    functions: Object.freeze([...functions])
  }) as unknown as ResonateFunctions<Function>

/** Creates a flat function collection from steps and workflows. */
export const make = <const Functions extends ReadonlyArray<AnyFunction>>(
  ...functions: Functions
): ResonateFunctions<Functions[number]> => makeProto(functions)
