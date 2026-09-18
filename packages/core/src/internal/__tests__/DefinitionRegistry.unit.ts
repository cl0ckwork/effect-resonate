import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as ResonateFunctions from "../../ResonateFunctions.js"
import * as Step from "../../Step.js"
import * as Workflow from "../../Workflow.js"
import * as DefinitionRegistry from "../DefinitionRegistry.js"

const NullStep = Step.make({
  name: "inventory.reserve",
  version: 1,
  input: Schema.Null,
  success: Schema.Null,
  failure: Schema.Never
})

describe("DefinitionRegistry", () => {
  it("accepts multiple exact versions and freezes their registration order", async () => {
    const V2 = Step.evolve(NullStep, {
      version: 2,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })

    const registry = await Effect.runPromise(
      DefinitionRegistry.make(ResonateFunctions.make(NullStep, V2))
    )

    assert.deepStrictEqual(registry.definitions, [NullStep, V2])
    assert.isTrue(Object.isFrozen(registry.definitions))
  })

  it("rejects invalid dynamic names and versions in the typed channel", async () => {
    const dynamicVersion: number = Number.NaN
    const Invalid = Step.make({
      name: " ",
      version: dynamicVersion,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })

    const failure = await Effect.runPromise(Effect.flip(
      DefinitionRegistry.make(ResonateFunctions.make(Invalid))
    ))

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/InvalidDefinition",
      definitionKind: "Step",
      issue: "EmptyName"
    })
  })

  it("rejects duplicate name/version pairs across function kinds", async () => {
    const WorkflowWithSameIdentity = Workflow.make({
      name: NullStep.name,
      version: NullStep.version,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })

    const failure = await Effect.runPromise(Effect.flip(
      DefinitionRegistry.make(ResonateFunctions.make(NullStep, WorkflowWithSameIdentity))
    ))

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/DuplicateDefinition",
      definitionName: NullStep.name,
      definitionVersion: NullStep.version
    })
  })

  it("rejects non-increasing dynamic evolution lineage", async () => {
    const dynamicVersion: number = 1
    const InvalidV2 = Step.evolve(NullStep, {
      version: dynamicVersion,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })

    const failure = await Effect.runPromise(Effect.flip(
      DefinitionRegistry.make(ResonateFunctions.make(NullStep, InvalidV2))
    ))

    assert.deepInclude(failure, {
      _tag: "@effect-resonate/core/InvalidDefinition",
      issue: "VersionNotIncreasing"
    })
  })
})
