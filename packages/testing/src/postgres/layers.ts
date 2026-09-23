import { randomUUID } from "node:crypto"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Effect, Layer } from "effect"
import { Client } from "pg"
import { makeNetworkHarnessLayer } from "../index.js"
import { testEnv } from "./env.js"
import { createIntegresqlClient, dbConfigToHostUrl } from "./integresql.js"

export const controlDatabaseUrl = (postgresPort: number): string =>
  `postgresql://effect_resonate_test:effect_resonate_test_password@127.0.0.1:${postgresPort}/effect_resonate_test`

const withControlClient = <A>(
  postgresPort: number,
  use: (client: Client) => Effect.Effect<A>
): Effect.Effect<A> => Effect.scoped(Effect.gen(function*() {
  const client = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const client = new Client({ connectionString: controlDatabaseUrl(postgresPort) })
      await client.connect()
      return client
    }),
    (client) => Effect.promise(() => client.end())
  )
  return yield* use(client)
}))

const scheduleTimeouts = (postgresPort: number, database: string, jobName: string) =>
  withControlClient(postgresPort, (client) => Effect.promise(async () => {
    await client.query(
      "SELECT cron.schedule_in_database($1, '5 seconds', 'SELECT resonate.process_timeouts()', $2)",
      [jobName, database]
    )
    const active = await client.query<{ active: boolean }>(
      "SELECT active FROM cron.job WHERE jobname = $1 AND database = $2",
      [jobName, database]
    )
    if (active.rows[0]?.active !== true) throw new Error("The test database has no active timeout job")
  }))

const unscheduleTimeouts = (postgresPort: number, jobName: string) =>
  withControlClient(postgresPort, (client) => Effect.promise(async () => {
    const jobs = await client.query<{ jobid: string }>("SELECT jobid FROM cron.job WHERE jobname = $1", [jobName])
    for (const job of jobs.rows) await client.query("SELECT cron.unschedule($1::bigint)", [job.jobid])
  }))

const testDatabase = Effect.gen(function*() {
  const env = yield* testEnv
  const integresql = createIntegresqlClient(env.integresqlUrl.toString())
  const lease = yield* Effect.acquireRelease(
    Effect.promise(() => integresql.getTestDatabase(env.templateHash)).pipe(
      Effect.map((database) => ({
        connectionString: dbConfigToHostUrl(integresql, database, env.postgresPort),
        database: database.database,
        jobName: `effect_resonate_${randomUUID()}`
      }))
    ),
    (lease) => unscheduleTimeouts(env.postgresPort, lease.jobName)
  )
  yield* scheduleTimeouts(env.postgresPort, lease.database, lease.jobName)
  return lease.connectionString
})

export const PostgresItestLayer = Layer.unwrap(testDatabase.pipe(Effect.map((connectionString) => Layer.merge(
  PostgresNetwork.layer({ connectionString, tickMs: 100 }),
  makeNetworkHarnessLayer({
    name: "sdk-postgres",
    setupTimeout: "10 seconds",
    acquire: Effect.succeed({
      timing: { pollInterval: "100 millis", scenarioTimeout: "30 seconds" },
      capabilities: {
        recovery: true as const,
        timeout: { invocationTimeoutMillis: 500 },
        invalidNonDurableAwait: true as const
      },
      observe: ({ executionIds }) => Effect.succeed({
        phase: "unknown" as const,
        activeWorkers: 0,
        executions: executionIds.map((id) => ({ id, state: "unknown" as const }))
      })
    })
  })
))))
