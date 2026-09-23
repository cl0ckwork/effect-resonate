import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Effect, Schedule, Schema } from "effect"
import { Client } from "pg"
import type { TestProject } from "vitest/node"
import { schemaVersion } from "./env.js"
import { createIntegresqlClient, dbConfigToHostUrl, hashMigrations } from "./integresql.js"

const composeFile = fileURLToPath(new URL("../../docker-compose.yml", import.meta.url))
const fixture = ({ name }: { readonly name: string }) =>
  fileURLToPath(new URL(`./docker/fixtures/${name}`, import.meta.url))
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))
const execFileAsync = promisify(execFile)

const compose = (options: { readonly projectName: string; readonly command: ReadonlyArray<string> }) =>
  Effect.tryPromise((signal) => execFileAsync(
    "docker", ["compose", "-f", composeFile, "-p", options.projectName, ...options.command],
    { encoding: "utf8", signal, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }
  ).then(({ stdout }) => stdout))

const waitForIntegresql = ({ url }: { readonly url: string }) =>
  Effect.tryPromise((signal) => fetch(new URL("api/v1/templates/__readiness__/tests", url), { signal }).then((response) => {
    if (response.status >= 500) throw new Error(`IntegreSQL readiness returned ${response.status}`)
  })).pipe(
    Effect.timeout("2 seconds"),
    Effect.retry({ times: 30, schedule: Schedule.spaced("500 millis") })
  )

const publishedPort = (options: {
  readonly projectName: string
  readonly service: string
  readonly containerPort: number
}) => Effect.gen(function*() {
  const address = yield* compose({
    projectName: options.projectName,
    command: ["port", options.service, String(options.containerPort)]
  })
  return yield* Schema.decodeUnknownEffect(Port)(/:(\d+)$/.exec(address.trim())?.[1])
})

const migrate = (options: {
  readonly connectionString: string
  readonly expectedSchemaVersion: string
}) => Effect.scoped(Effect.gen(function*() {
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => new Client({ connectionString: options.connectionString })),
    (client) => Effect.promise(() => client.end())
  )
  yield* Effect.promise(() => client.connect())
  const schema = yield* Effect.promise(() => readFile(fixture({ name: "resonate.sql" }), "utf8"))
  yield* Effect.promise(() => client.query(schema))
  const compatibility = yield* Effect.promise(() => readFile(fixture({ name: "001-sdk-global-promise.sql" }), "utf8"))
  yield* Effect.promise(() => client.query(compatibility))
  const check = yield* Effect.promise(() => client.query<{ version: string | null }>(
    "SELECT resonate.get_schema_version() AS version"
  ))
  if (check.rows[0]?.version !== options.expectedSchemaVersion) {
    return yield* Effect.fail(new Error("Resonate SQL schema version does not match POSTGRES_TEST_SCHEMA_VERSION"))
  }
}))

const setupEffect = ({ project }: { readonly project: TestProject }) => Effect.gen(function*() {
  const projectName = `effect-resonate-test-${randomUUID().slice(0, 8)}`
  const teardown = compose({ projectName, command: ["down", "-v", "--remove-orphans"] })
  yield* Effect.gen(function*() {
    yield* compose({ projectName, command: ["up", "-d", "--build", "--wait"] })
    const postgresPort = yield* publishedPort({ projectName, service: "postgres", containerPort: 5432 })
    const integresqlPort = yield* publishedPort({ projectName, service: "integresql", containerPort: 5000 })
    const expectedSchemaVersion = yield* schemaVersion
    const integresqlUrl = `http://127.0.0.1:${integresqlPort}/`
    yield* waitForIntegresql({ url: integresqlUrl })
    const integresql = createIntegresqlClient({ url: integresqlUrl })
    const templateHash = yield* Effect.promise(() => hashMigrations({ client: integresql }))
    yield* Effect.promise(() => integresql.initializeTemplate(
      templateHash,
      (database) => Effect.runPromise(
        migrate({
          connectionString: dbConfigToHostUrl({ client: integresql, config: database, postgresPort }),
          expectedSchemaVersion
        })
      )
    ))
    yield* Effect.sync(() => project.provide("postgres", { postgresPort, integresqlPort, templateHash }))
  }).pipe(Effect.onError(() => teardown.pipe(Effect.asVoid, Effect.orDie)))

  return () => Effect.runPromise(teardown)
})

export const setup = (project: TestProject) => Effect.runPromise(setupEffect({ project }))
