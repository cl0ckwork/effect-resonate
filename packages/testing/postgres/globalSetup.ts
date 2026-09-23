import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { IntegreSQLClient } from "@devoxa/integresql-client"
import { Effect, Exit, Schema, Scope } from "effect"
import { Client } from "pg"
import type { TestProject } from "vitest/node"

declare module "vitest" {
  interface ProvidedContext {
    postgres: { postgresPort: number; integresqlPort: number; templateHash: string }
  }
}

const composeFile = fileURLToPath(new URL("./docker-compose.yml", import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))

export const setup = async (project: TestProject) => {
  const projectName = `effect-resonate-test-${randomUUID().slice(0, 8)}`
  const compose = (...args: string[]) => Effect.sync(() => execFileSync(
    "docker", ["compose", "-f", composeFile, "-p", projectName, ...args],
    { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }
  ))
  const port = (service: string, containerPort: number) => Effect.gen(function*() {
    const address = (yield* compose("port", service, String(containerPort))).trim()
    return yield* Schema.decodeUnknownEffect(Port)(/:(\d+)$/.exec(address)?.[1])
  })

  const scope = await Effect.runPromise(Scope.make())
  try {
    const context = await Effect.runPromise(Effect.gen(function*() {
      // Register teardown before startup so a partial Compose failure is cleaned up.
      yield* Effect.acquireRelease(
        Effect.succeed(projectName),
        () => compose("down", "-v", "--remove-orphans").pipe(Effect.orDie)
      )
      yield* compose("up", "-d", "--build", "--wait")
      const postgresPort = yield* port("postgres", 5432)
      const integresqlPort = yield* port("integresql", 5000)
      const integresql = new IntegreSQLClient({ url: `http://127.0.0.1:${integresqlPort}/` })
      const templateHash = yield* Effect.promise(() => integresql.hashFiles([
        "postgres/fixtures/**/*", "postgres/docker/**/*", "postgres/docker-compose.yml"
      ]))
      yield* Effect.promise(() => integresql.initializeTemplate(templateHash, async (database) => {
        const connectionString = integresql.databaseConfigToConnectionUrl({
          ...database, host: "127.0.0.1", port: postgresPort
        })
        await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
          const client = yield* Effect.acquireRelease(
            Effect.sync(() => new Client({ connectionString })),
            (client) => Effect.promise(() => client.end())
          )
          yield* Effect.promise(() => client.connect())
          yield* Effect.promise(async () => {
            await client.query(await readFile(fixture("resonate.sql"), "utf8"))
            await client.query(await readFile(fixture("001-sdk-global-promise.sql"), "utf8"))
            const check = await client.query<{ version: string | null }>(
              "SELECT resonate.get_schema_version() AS version"
            )
            if (check.rows[0]?.version !== "0.1.0") throw new Error("Resonate SQL migration did not apply")
          })
        })))
      }))
      return { postgresPort, integresqlPort, templateHash }
    }).pipe(Effect.provideService(Scope.Scope, scope)))
    project.provide("postgres", context)
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)))
    throw error
  }

  return () => Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)))
}
