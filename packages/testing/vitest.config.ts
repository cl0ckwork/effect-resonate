import { fileURLToPath } from "node:url"
import { Config, Effect } from "effect"
import { defineConfig } from "vitest/config"

const skipPostgres = Effect.runSync(Config.Boolean("SKIP_POSTGRES_TESTS").pipe(
  Config.withDefault(false)
))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@effect-resonate\/core$/,
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url))
      },
      {
        find: /^@effect-resonate\/core\/(.*)$/,
        replacement: `${fileURLToPath(new URL("../core/src/", import.meta.url))}$1.ts`
      },
      {
        find: /^@effect-resonate\/network-postgres$/,
        replacement: fileURLToPath(new URL("../network-postgres/src/index.ts", import.meta.url))
      }
    ]
  },
  test: {
    include: [
      "src/**/__tests__/**/*.unit.ts",
      "src/**/__tests__/**/*.integration.ts"
    ],
    exclude: skipPostgres ? ["src/__tests__/PostgresNetwork.integration.ts"] : [],
    globalSetup: skipPostgres ? [] : ["./src/postgres/globalSetup.ts"],
    setupFiles: skipPostgres ? [] : ["./src/postgres/setupFile.ts"],
    pool: "threads",
    maxWorkers: 2,
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 90_000,
    hookTimeout: 90_000
  }
})
