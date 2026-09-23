import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, type Scope } from "effect"
import { makePostgresItestLayer, type PostgresItestOptions } from "./layers.js"

type Services = Layer.Success<ReturnType<typeof makePostgresItestLayer>>

export const itest = <A, E>(
  name: string,
  test: () => Effect.Effect<A, E, Services | Scope.Scope>,
  options: PostgresItestOptions = {}
): void => effectIt.live(name, () => test().pipe(Effect.provide(Layer.fresh(makePostgresItestLayer(options)))))
