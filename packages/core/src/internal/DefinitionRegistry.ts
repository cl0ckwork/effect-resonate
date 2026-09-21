import { Effect } from "effect"
import {
  DuplicateDefinition,
  InvalidDefinition
} from "../CoreExecutionError.js"
import type * as ResonateFunctions from "../ResonateFunctions.js"
import type * as Step from "../Step.js"
import type * as Workflow from "../Workflow.js"

export type Definition = Step.Any | Workflow.Any

export interface DefinitionRegistry {
  readonly definitions: ReadonlyArray<Definition>
}

export type Error = InvalidDefinition | DuplicateDefinition

const invalid = (
  definition: Definition,
  issue: InvalidDefinition["issue"]
): InvalidDefinition => new InvalidDefinition({
  definitionKind: definition.kind,
  issue
})

const validateIdentity = (definition: Definition): InvalidDefinition | undefined => {
  if (definition.name.trim().length === 0) {
    return invalid(definition, "EmptyName")
  }
  if (!Number.isInteger(definition.version) || definition.version <= 0) {
    return invalid(definition, "VersionNotPositiveInteger")
  }
  return undefined
}

const validateLineage = (
  definition: Definition,
  visited: ReadonlySet<Definition> = new Set()
): InvalidDefinition | undefined => {
  if (visited.has(definition)) {
    return invalid(definition, "InvalidEvolutionLineage")
  }
  const previous = definition.previous
  if (previous === undefined) {
    return undefined
  }
  const lineage = new Set([...visited, definition])
  if (lineage.has(previous)) {
    return invalid(definition, "InvalidEvolutionLineage")
  }
  const identityIssue = validateIdentity(previous)
  if (identityIssue !== undefined) {
    return identityIssue
  }
  if (previous.kind !== definition.kind || previous.name !== definition.name) {
    return invalid(definition, "InvalidEvolutionLineage")
  }
  if (definition.version <= previous.version) {
    return invalid(definition, "VersionNotIncreasing")
  }
  return validateLineage(previous, lineage)
}

const validateDefinition = (definition: Definition): InvalidDefinition | undefined => {
  const identityIssue = validateIdentity(definition)
  if (identityIssue !== undefined) {
    return identityIssue
  }
  return validateLineage(definition)
}

/** Validates dynamic identities and freezes one exact registration sequence. */
export const make = (
  group: ResonateFunctions.Any
): Effect.Effect<DefinitionRegistry, Error> => Effect.gen(function*() {
  const identities = new Set<string>()
  for (const definition of group.functions) {
    const issue = validateDefinition(definition)
    if (issue !== undefined) {
      return yield* issue
    }
    const identity = `${definition.name}\u0000${definition.version}`
    if (identities.has(identity)) {
      return yield* new DuplicateDefinition({
        definitionName: definition.name,
        definitionVersion: definition.version
      })
    }
    identities.add(identity)
  }
  return { definitions: Object.freeze([...group.functions]) }
})
