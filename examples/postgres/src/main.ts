import { randomUUID } from "node:crypto"
import { ResonateClient, ResonateFunctions, Step, Workflow } from "@effect-resonate/core"
import { PostgresNetwork } from "@resonatehq/sdk/postgres"
import { ResonateNetwork } from "@effect-resonate/core"
import { Config, Effect, Layer, Redacted, Schema } from "effect"

// Keep v1 registered while any v1 executions may still be running or replaying.
const NormalizeV1 = Step.make({
  name: "example.text.normalize",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})

const TextV1 = Workflow.make({
  name: "example.text.process",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})

const NormalizeV2 = Step.evolve(NormalizeV1, {
  version: 2,
  input: Schema.Struct({ text: Schema.String, locale: Schema.String }),
  success: Schema.Struct({ value: Schema.String, length: Schema.Number }),
  failure: Schema.Never
})

const TextV2 = Workflow.evolve(TextV1, {
  version: 2,
  input: Schema.Struct({ text: Schema.String, locale: Schema.String }),
  success: NormalizeV2.success,
  failure: Schema.Never
})

/**
 * `toLayer` binds the V1 contract to its Effect implementation. Resonate runs
 * this step and records its completed result for replay.
 */
const NormalizeV1Live = NormalizeV1.toLayer((text) => Effect.sync(() => text.trim().toUpperCase()))

/**
 * Workflow code uses Resonate's context for durable calls. `context.run`
 * returns the step's Result, which becomes this workflow's Result.
 */
const TextV1Live = TextV1.toLayer(async (context, text) => context.run(NormalizeV1, text))

/** V2 changes the step contract and implementation while V1 stays registered. */
const NormalizeV2Live = NormalizeV2.toLayer(({ text, locale }) =>
  Effect.sync(() => {
    const value = text.trim().toLocaleUpperCase(locale)
    return { value, length: value.length }
  })
)

/** V2 calls its matching step version; retained V1 executions still call V1. */
const TextV2Live = TextV2.toLayer(async (context, input) => context.run(NormalizeV2, input))

// Load the database URL when the network Layer is acquired. Redacted keeps the
// credential out of ordinary logging; the SDK receives the string at this boundary.
const NetworkLive = Layer.unwrap(
  Config.Redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      ResonateNetwork.layer({
        make: () => new PostgresNetwork({ connectionString: Redacted.value(url) })
      })
    )
  )
)

const ClientLive = ResonateClient.layer({
  functions: ResonateFunctions.make(NormalizeV1, NormalizeV2, TextV1, TextV2),
  drainTimeout: "30 seconds"
}).pipe(
  Layer.provide(
    Layer.mergeAll(NetworkLive, NormalizeV1Live, TextV1Live, NormalizeV2Live, TextV2Live)
  )
)

const program = Effect.gen(function* () {
  const oldRun = yield* ResonateClient.run(`text-v1-${randomUUID()}`, TextV1, "  hello  ")
  console.log("v1:", yield* oldRun.result())

  const newRun = yield* ResonateClient.run(`text-v2-${randomUUID()}`, TextV2, {
    text: "  grüße  ",
    locale: "de-DE"
  })
  console.log("v2:", yield* newRun.result())
}).pipe(Effect.provide(ClientLive))

await Effect.runPromise(program)
