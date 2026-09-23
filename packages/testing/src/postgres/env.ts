import { Config } from "effect"

// setupFile.ts supplies these values after Vitest global setup starts Compose.
export const testEnv = Config.all({
  integresqlUrl: Config.URL("ITEST_INTEGRESQL_URL"),
  postgresPort: Config.Port("ITEST_POSTGRES_PORT"),
  templateHash: Config.String("ITEST_TEMPLATE_HASH")
})
