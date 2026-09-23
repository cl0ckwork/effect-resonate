import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, type Scope } from "effect"
import { makePostgresItestLayer, type PostgresItestOptions } from "./layers.js"

type Services = Layer.Success<ReturnType<typeof makePostgresItestLayer>>

export const itest = <A, E>(options: PostgresItestOptions & {
  readonly name: string
  readonly run: () => Effect.Effect<A, E, Services | Scope.Scope>
}): void => {
  const { name, run, ...layerOptions } = options
  effectIt.live(name, () => run().pipe(Effect.provide(Layer.fresh(makePostgresItestLayer(layerOptions)))))
}
