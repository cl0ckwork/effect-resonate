import { randomUUID } from "node:crypto"
import { ResonateClient, ResonateFunctions, Step, Workflow } from "@effect-resonate/core"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Effect, Layer, Schema } from "effect"

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

const ClientLive = ResonateClient.layer({
  functions: ResonateFunctions.make(NormalizeV1, NormalizeV2, TextV1, TextV2),
  drainTimeout: "30 seconds"
}).pipe(
  Layer.provide(
    Layer.mergeAll(
      PostgresNetwork.layer({
        connectionString:
          process.env.DATABASE_URL ??
          "postgres://effect_resonate_example:effect_resonate_example_password@127.0.0.1:55432/effect_resonate_example"
      }),
      NormalizeV1.toLayer((text) => Effect.succeed(text.trim().toUpperCase())),
      TextV1.toLayer(async (context, text) => context.run(NormalizeV1, text)),
      NormalizeV2.toLayer(({ text, locale }) =>
        Effect.sync(() => {
          const value = text.trim().toLocaleUpperCase(locale)
          return { value, length: value.length }
        })
      ),
      TextV2.toLayer(async (context, input) => context.run(NormalizeV2, input))
    )
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
