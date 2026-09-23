import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, type Scope } from "effect"
import { PostgresItestLayer } from "./layers.js"

type Services = Layer.Success<typeof PostgresItestLayer>

export const itest = <A, E>(name: string, test: () => Effect.Effect<A, E, Services | Scope.Scope>): void => {
  effectIt.live(name, () => test().pipe(Effect.provide(Layer.fresh(PostgresItestLayer))))
}
