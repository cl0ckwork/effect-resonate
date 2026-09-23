import { Config, Context, Effect, Layer } from "effect"
import { inject } from "vitest"

declare module "vitest" {
  interface ProvidedContext {
    postgres: { postgresPort: number; integresqlPort: number; templateHash: string }
  }
}

export const schemaVersion = Config.String("POSTGRES_TEST_SCHEMA_VERSION").pipe(
  Config.withDefault("0.1.0")
)

export class PostgresTestEnv extends Context.Service<PostgresTestEnv, {
  readonly postgresPort: number
  readonly integresqlUrl: string
  readonly templateHash: string
}>()("@effect-resonate/testing/PostgresTestEnv") {
  static readonly layer = Layer.effect(
    PostgresTestEnv,
    Effect.sync(() => {
      const { postgresPort, integresqlPort, templateHash } = inject("postgres")
      return PostgresTestEnv.of({
        postgresPort,
        integresqlUrl: `http://127.0.0.1:${integresqlPort}/`,
        templateHash
      })
    })
  )
}
