import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { IntegreSQLClient, type IntegreSQLDatabaseConfig } from "@devoxa/integresql-client"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { makeNetworkHarnessLayer } from "../../src/index.js"
import { Client } from "pg"
import { Effect, Layer } from "effect"

const appFile = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const postgresPort = Number(process.env.POSTGRES_E2E_PORT)
const integresqlPort = Number(process.env.INTEGRESQL_E2E_PORT)

if (!Number.isInteger(postgresPort) || !Number.isInteger(integresqlPort)) {
  throw new Error("The Postgres e2e suite must run through postgres/scripts/run.mjs")
}

const integresql = new IntegreSQLClient({ url: `http://127.0.0.1:${integresqlPort}/` })

const connectionString = (database: IntegreSQLDatabaseConfig): string => {
  const url = new URL("postgresql://127.0.0.1")
  url.username = database.username
  url.password = database.password
  url.port = String(postgresPort)
  url.pathname = `/${database.database}`
  return url.toString()
}

export const controlUrl = "postgresql://postgres:postgres_test_password@127.0.0.1:" + postgresPort + "/postgres"

const withClient = async <A>(url: string, use: (client: Client) => Promise<A>): Promise<A> => {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

const fixturePaths = [
  "fixtures/resonate.sql",
  "fixtures/001-sdk-global-promise.sql",
  "fixtures/UPSTREAM.md",
  "docker/Dockerfile",
  "docker/01-cron.sql",
  "compose.yaml"
]

export const initializeTemplate = async (): Promise<string> => {
  const files = await Promise.all(fixturePaths.map((path) => readFile(appFile(path))))
  const hash = createHash("sha1")
  for (const file of files) hash.update(file)
  const templateHash = hash.digest("hex")
  const migration = files[0]?.toString("utf8")
  const compatibilityMigration = files[1]?.toString("utf8")
  if (migration === undefined || compatibilityMigration === undefined) {
    throw new Error("Missing Resonate SQL fixture")
  }

  await integresql.initializeTemplate(templateHash, async (database) => {
    await withClient(connectionString(database), async (client) => {
      await client.query(migration)
      await client.query(compatibilityMigration)
      const check = await client.query<{ version: string | null }>(
        "SELECT resonate.get_schema_version() AS version"
      )
      if (check.rows[0]?.version !== "0.1.0") throw new Error("Resonate SQL migration did not apply")
    })
  })
  return templateHash
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

export const withDatabase = async (templateHash: string, run: (url: string) => Promise<void>): Promise<void> => {
  const lease = await integresql.api.getTestDatabase(templateHash)
  const url = connectionString(lease.database.config)
  const jobName = `resonate_u7_${createHash("sha256").update(lease.database.config.database).digest("hex").slice(0, 16)}`
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
