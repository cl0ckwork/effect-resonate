import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { IntegreSQLClient } from "@devoxa/integresql-client"
import { Effect, Schema } from "effect"
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
  const compose = (...args: string[]) => execFileSync(
    "docker", ["compose", "-f", composeFile, "-p", projectName, ...args],
    { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }
  )
  const port = (service: string, containerPort: number) =>
    Schema.decodeUnknownSync(Port)(/:(\d+)$/.exec(compose("port", service, String(containerPort)).trim())?.[1])

  try {
    compose("up", "-d", "--build", "--wait")
    const postgresPort = port("postgres", 5432)
    const integresqlPort = port("integresql", 5000)
    const integresql = new IntegreSQLClient({ url: `http://127.0.0.1:${integresqlPort}/` })
    const templateHash = await integresql.hashFiles([
      "src/postgres/fixtures/**/*", "src/postgres/docker/**/*", "src/postgres/docker-compose.yml"
    ])
    await integresql.initializeTemplate(templateHash, async (database) => {
      const connectionString = integresql.databaseConfigToConnectionUrl({
        ...database, host: "127.0.0.1", port: postgresPort
      })
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const client = yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const client = new Client({ connectionString })
            await client.connect()
            return client
          }),
          (client) => Effect.promise(() => client.end())
        )
        yield* Effect.promise(async () => {
          await client.query(await readFile(fixture("resonate.sql"), "utf8"))
          await client.query(await readFile(fixture("001-sdk-global-promise.sql"), "utf8"))
          const check = await client.query<{ version: string | null }>(
            "SELECT resonate.get_schema_version() AS version"
          )
          if (check.rows[0]?.version !== "0.1.0") throw new Error("Resonate SQL migration did not apply")
        })
      })))
    })
    project.provide("postgres", { postgresPort, integresqlPort, templateHash })
  } catch (error) {
    compose("down", "-v", "--remove-orphans")
    throw error
  }

  return () => { compose("down", "-v", "--remove-orphans") }
}
