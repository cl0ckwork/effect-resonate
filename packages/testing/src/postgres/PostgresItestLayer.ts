import { randomUUID } from "node:crypto"
import { PostgresNetwork, type PostgresNetworkConfig } from "@resonatehq/sdk/postgres"
import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"
import { Effect, Layer, type Duration } from "effect"
import { Client } from "pg"
import type { HarnessTiming } from "../NetworkHarness.js"
import { makeNetworkHarnessLayer } from "../index.js"
import { PostgresTestEnv } from "./env.js"
import { createIntegresqlClient, dbConfigToHostUrl } from "./integresql.js"

export const controlDatabaseUrl = ({ postgresPort }: { readonly postgresPort: number }): string =>
  `postgresql://effect_resonate_test:effect_resonate_test_password@127.0.0.1:${postgresPort}/effect_resonate_test`

const withControlClient = <A>(options: {
  readonly postgresPort: number
  readonly use: (client: Client) => Effect.Effect<A>
}): Effect.Effect<A> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Client({
              connectionString: controlDatabaseUrl({ postgresPort: options.postgresPort })
            })
        ),
        (client) => Effect.promise(() => client.end())
      )
      yield* Effect.promise(() => client.connect())
      return yield* options.use(client)
    })
  )

const scheduleTimeouts = (options: {
  readonly postgresPort: number
  readonly database: string
  readonly jobName: string
}) =>
  withControlClient({
    postgresPort: options.postgresPort,
    use: (client) =>
      Effect.promise(async () => {
        await client.query(
          "SELECT cron.schedule_in_database($1, '5 seconds', 'SELECT resonate.process_timeouts()', $2)",
          [options.jobName, options.database]
        )
        const active = await client.query<{ active: boolean }>(
          "SELECT active FROM cron.job WHERE jobname = $1 AND database = $2",
          [options.jobName, options.database]
        )
        if (active.rows[0]?.active !== true)
          throw new Error("The test database has no active timeout job")
      })
  })

const unscheduleTimeouts = (options: { readonly postgresPort: number; readonly jobName: string }) =>
  withControlClient({
    postgresPort: options.postgresPort,
    use: (client) =>
      Effect.promise(async () => {
        const jobs = await client.query<{ jobid: string }>(
          "SELECT jobid FROM cron.job WHERE jobname = $1",
          [options.jobName]
        )
        for (const job of jobs.rows)
          await client.query("SELECT cron.unschedule($1::bigint)", [job.jobid])
      })
  })

const testDatabase = Effect.gen(function* () {
  const env = yield* PostgresTestEnv
  const integresql = createIntegresqlClient({ url: env.integresqlUrl })
  const lease = yield* Effect.acquireRelease(
    Effect.promise(() => integresql.getTestDatabase(env.templateHash)).pipe(
      Effect.map((database) => ({
        connectionString: dbConfigToHostUrl({
          client: integresql,
          config: database,
          postgresPort: env.postgresPort
        }),
        database: database.database,
        jobName: `effect_resonate_${randomUUID()}`
      }))
    ),
    (lease) => unscheduleTimeouts({ postgresPort: env.postgresPort, jobName: lease.jobName })
  )
  yield* scheduleTimeouts({
    postgresPort: env.postgresPort,
    database: lease.database,
    jobName: lease.jobName
  })
  return lease.connectionString
})

export interface PostgresItestOptions {
  /** Official SDK options, including its optional tick interval; IntegreSQL supplies the connection. */
  readonly network?: Omit<PostgresNetworkConfig, "connectionString">
  /** Harness polling and deadlines are independent of the SDK's fallback tick. */
  readonly timing?: Partial<HarnessTiming>
  readonly setupTimeout?: Duration.Input
  readonly invocationTimeoutMillis?: number
}

export const makePostgresItestLayer = (options: PostgresItestOptions = {}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const connectionString = yield* testDatabase
      return Layer.merge(
        ResonateNetwork.layer({
          make: () => new PostgresNetwork({ connectionString, ...options.network })
        }),
        makeNetworkHarnessLayer({
          name: "sdk-postgres",
          setupTimeout: options.setupTimeout ?? "10 seconds",
          acquire: Effect.succeed({
            timing: {
              pollInterval: options.timing?.pollInterval ?? "100 millis",
              scenarioTimeout: options.timing?.scenarioTimeout ?? "30 seconds"
            },
            capabilities: {
              recovery: true as const,
              timeout: { invocationTimeoutMillis: options.invocationTimeoutMillis ?? 500 },
              invalidNonDurableAwait: true as const
            },
            observe: ({ executionIds }) =>
              Effect.succeed({
                phase: "unknown" as const,
                activeWorkers: 0,
                executions: executionIds.map((id) => ({ id, state: "unknown" as const }))
              })
          })
        })
      )
    })
  )
