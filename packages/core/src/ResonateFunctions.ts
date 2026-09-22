import type * as Step from "./Step.js"
import type * as Workflow from "./Workflow.js"

const TypeId = "@effect-resonate/core/ResonateFunctions"

export type AnyFunction = Step.Any | Workflow.Any

/** A closed, immutable collection of Resonate functions. */
export interface ResonateFunctions<out Function extends AnyFunction> {
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

type StepHandlers<Definition> = Definition extends Step.Any ? Step.Step.Implementation<Definition> : never

type WorkflowHandlers<Definition> = Definition extends Workflow.Any
  ? Workflow.Workflow.Implementation<Definition>
  : never

/** Computes the implementation services required by the collection. */
export type Handlers<Group> =
  | StepHandlers<Steps<Group>>
  | WorkflowHandlers<Workflows<Group>>

const makeGroup = <Function extends AnyFunction>(
  functions: ReadonlyArray<Function>
): ResonateFunctions<Function> => Object.freeze({
  [TypeId]: TypeId,
  functions: Object.freeze([...functions]),
  add: <const Added extends ReadonlyArray<AnyFunction>>(...added: Added) =>
    makeGroup<Function | Added[number]>([...functions, ...added]),
  merge: <const Groups extends ReadonlyArray<Any>>(...groups: Groups) =>
    makeGroup<Function | Functions<Groups[number]>>(([
      ...functions,
      ...groups.flatMap((group) => group.functions)
    ]) as unknown as ReadonlyArray<Function | Functions<Groups[number]>>)
})

/** Creates a flat function collection from steps and workflows. */
export const make = <const Functions extends ReadonlyArray<AnyFunction>>(
  ...functions: Functions
): ResonateFunctions<Functions[number]> => makeGroup(functions)
