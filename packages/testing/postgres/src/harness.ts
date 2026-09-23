import { randomUUID } from "node:crypto"
import { IntegreSQLClient } from "@devoxa/integresql-client"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { makeNetworkHarnessLayer } from "../../src/index.js"
import { Client } from "pg"
import { Effect, Layer } from "effect"
import { inject } from "vitest"

const { postgresPort, integresqlPort, templateHash } = inject("postgres")
const integresql = new IntegreSQLClient({ url: `http://127.0.0.1:${integresqlPort}/` })
const controlUrl = `postgresql://effect_resonate_test:effect_resonate_test_password@127.0.0.1:${postgresPort}/effect_resonate_test`

const withClient = async <A>(url: string, use: (client: Client) => Promise<A>): Promise<A> => {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

const verifyLease = async (url: string): Promise<void> => withClient(url, async (client) => {
  const { rows } = await client.query<{
    version: number
    rpc: string | null
    timeouts: string | null
    dequeue: string | null
  }>(`SELECT current_setting('server_version_num')::int AS version,
      to_regprocedure('resonate.resonate_rpc(jsonb)')::text AS rpc,
      to_regprocedure('resonate.process_timeouts()')::text AS timeouts,
      to_regprocedure('resonate.dequeue_execute(text,integer)')::text AS dequeue`)
  const ready = rows[0]
  if (ready === undefined || ready.version < 160000 || !ready.rpc || !ready.timeouts || !ready.dequeue) {
    throw new Error("Leased database is missing the required Resonate schema")
  }
})

const scheduleTimeouts = async (database: string, jobName: string): Promise<void> =>
  withClient(controlUrl, async (client) => {
    const { rows } = await client.query<{ installed: string | null }>(
      "SELECT extversion AS installed FROM pg_extension WHERE extname = 'pg_cron'"
    )
    if (!rows[0]?.installed) throw new Error("pg_cron is not installed in the control database")
    await client.query(
      "SELECT cron.schedule_in_database($1, '5 seconds', 'SELECT resonate.process_timeouts()', $2)",
      [jobName, database]
    )
    const active = await client.query<{ active: boolean }>(
      "SELECT active FROM cron.job WHERE jobname = $1 AND database = $2",
      [jobName, database]
    )
    if (active.rows[0]?.active !== true) throw new Error("The leased database has no active timeout job")
  })

const unscheduleTimeouts = async (jobName: string): Promise<void> =>
  withClient(controlUrl, async (client) => {
    const jobs = await client.query<{ jobid: string }>(
      "SELECT jobid FROM cron.job WHERE jobname = $1",
      [jobName]
    )
    for (const job of jobs.rows) await client.query("SELECT cron.unschedule($1::bigint)", [job.jobid])
  })

export const withDatabase = async (run: (url: string) => Promise<void>): Promise<void> => {
  // The convenience getTestDatabase() returns only config; the API response also
  // supplies the lease ID needed by reuseTestDatabase().
  const lease = await integresql.api.getTestDatabase(templateHash)
  const url = integresql.databaseConfigToConnectionUrl({
    ...lease.database.config, host: "127.0.0.1", port: postgresPort
  })
  // Each IntegreSQL clone needs the Resonate schema and its own timeout driver.
  // The cron extension lives in the control database, so schedule its job into
  // this clone before the scenario and remove it before returning the lease.
  const jobName = `effect_resonate_${randomUUID()}`
  try {
    await verifyLease(url)
    await scheduleTimeouts(lease.database.config.database, jobName)
    await run(url)
  } finally {
    try {
      await unscheduleTimeouts(jobName)
    } finally {
      await integresql.api.reuseTestDatabase(templateHash, lease.id)
    }
  }
}

export const scenarioLayer = (url: string) => Layer.merge(
  PostgresNetwork.layer({ connectionString: url, tickMs: 100 }),
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
)

export { controlUrl }
