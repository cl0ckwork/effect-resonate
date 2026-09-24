import { ResonateFunctions, Step, Workflow } from "@effect-resonate/core"
import { Effect, Result, Schema } from "effect"

export const NormalizeName = Step.make({
  name: "example.normalize-name",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})

export const Welcome = Workflow.make({
  name: "example.welcome",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})

export const Functions = ResonateFunctions.make(NormalizeName, Welcome)

export const NormalizeNameLive = NormalizeName.toLayer((name) =>
  Effect.succeed(name.trim().toUpperCase())
)

export const WelcomeLive = Welcome.toLayer(async (context, name) => {
  const normalized = Result.getOrThrow(await context.run(NormalizeName, name))
  return Result.succeed(`Welcome, ${normalized}!`)
})
