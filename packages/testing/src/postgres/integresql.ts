import { IntegreSQLClient, type IntegreSQLDatabaseConfig } from "@devoxa/integresql-client"

export const createIntegresqlClient = (url: string): IntegreSQLClient => new IntegreSQLClient({ url })

export const hashMigrations = (client: IntegreSQLClient): Promise<string> => client.hashFiles([
  "src/postgres/docker/fixtures/**/*"
])

export const dbConfigToHostUrl = (
  client: IntegreSQLClient,
  config: IntegreSQLDatabaseConfig,
  postgresPort: number
): string => client.databaseConfigToConnectionUrl({
  ...config,
  host: "127.0.0.1",
  port: postgresPort
})
