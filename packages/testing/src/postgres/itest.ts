import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, type Scope } from "effect"
import { PostgresTestEnv } from "./env.js"
import { makePostgresItestLayer, type PostgresItestOptions } from "./PostgresItestLayer.js"

type Services = Layer.Success<ReturnType<typeof makePostgresItestLayer>>

export const itest = <A, E>(
  name: string,
  test: () => Effect.Effect<A, E, Services | Scope.Scope>,
  options: PostgresItestOptions = {}
): void =>
  effectIt.live(name, () =>
    test().pipe(
      Effect.provide(
        Layer.fresh(makePostgresItestLayer(options)).pipe(Layer.provide(PostgresTestEnv.layer))
      )
    )
  )
