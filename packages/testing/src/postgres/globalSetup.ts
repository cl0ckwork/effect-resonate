import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { Client } from "pg"
import type { TestProject } from "vitest/node"
import { createIntegresqlClient, dbConfigToHostUrl, hashMigrations } from "./integresql.js"

declare module "vitest" {
  interface ProvidedContext {
    postgres: { postgresPort: number; integresqlPort: number; templateHash: string }
  }
}

const composeFile = fileURLToPath(new URL("../../docker-compose.yml", import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`./docker/fixtures/${name}`, import.meta.url))
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))

const compose = (projectName: string, ...args: string[]) => Effect.try(() => execFileSync(
  "docker", ["compose", "-f", composeFile, "-p", projectName, ...args],
  { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }
))

const port = (projectName: string, service: string, containerPort: number) => Effect.gen(function*() {
  const address = yield* compose(projectName, "port", service, String(containerPort))
  return yield* Schema.decodeUnknownEffect(Port)(/:(\d+)$/.exec(address.trim())?.[1])
})

const migrate = (connectionString: string) => Effect.scoped(Effect.gen(function*() {
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => new Client({ connectionString })),
    (client) => Effect.promise(() => client.end())
  )
  yield* Effect.promise(() => client.connect())
  const schema = yield* Effect.promise(() => readFile(fixture("resonate.sql"), "utf8"))
  yield* Effect.promise(() => client.query(schema))
  const compatibility = yield* Effect.promise(() => readFile(fixture("001-sdk-global-promise.sql"), "utf8"))
  yield* Effect.promise(() => client.query(compatibility))
  const check = yield* Effect.promise(() => client.query<{ version: string | null }>(
    "SELECT resonate.get_schema_version() AS version"
  ))
  if (check.rows[0]?.version !== "0.1.0") {
    return yield* Effect.fail(new Error("Resonate SQL migration did not apply"))
  }
}))

const setupEffect = (project: TestProject) => Effect.gen(function*() {
  const projectName = `effect-resonate-test-${randomUUID().slice(0, 8)}`
  const teardown = compose(projectName, "down", "-v", "--remove-orphans")
  yield* Effect.gen(function*() {
    yield* compose(projectName, "up", "-d", "--build", "--wait")
    const postgresPort = yield* port(projectName, "postgres", 5432)
    const integresqlPort = yield* port(projectName, "integresql", 5000)
    const integresql = createIntegresqlClient(`http://127.0.0.1:${integresqlPort}/`)
    const templateHash = yield* Effect.promise(() => hashMigrations(integresql))
    yield* Effect.promise(() => integresql.initializeTemplate(
      templateHash,
      (database) => Effect.runPromise(
        migrate(dbConfigToHostUrl(integresql, database, postgresPort))
      )
    ))
    yield* Effect.sync(() => project.provide("postgres", { postgresPort, integresqlPort, templateHash }))
  }).pipe(Effect.onError(() => teardown.pipe(Effect.asVoid, Effect.orDie)))

  return () => Effect.runPromise(teardown)
})

export const setup = (project: TestProject) => Effect.runPromise(setupEffect(project))
