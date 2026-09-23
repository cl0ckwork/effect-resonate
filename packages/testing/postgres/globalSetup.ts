import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { TestProject } from "vitest/node"
import { createHarness, type PostgresTestContext } from "./src/harness.js"

declare module "vitest" {
  interface ProvidedContext {
    postgres: PostgresTestContext
  }
}

const composeFile = fileURLToPath(new URL("./compose.yaml", import.meta.url))

export const setup = async (project: TestProject) => {
  const name = `effect-resonate-u7-${randomUUID().slice(0, 8)}`
  const compose = (...args: string[]) => execFileSync("docker", ["compose", "-f", composeFile, "-p", name, ...args], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"]
  })
  const port = (service: string, containerPort: number) => {
    const address = compose("port", service, String(containerPort)).trim()
    const value = Number(address.slice(address.lastIndexOf(":") + 1))
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${service} port`)
    return value
  }

  try {
    compose("up", "-d", "--build", "--wait")
    const postgresPort = port("postgres", 5432)
    const integresqlPort = port("integresql", 5000)
    const templateHash = await createHarness({ postgresPort, integresqlPort }).initializeTemplate()
    project.provide("postgres", { postgresPort, integresqlPort, templateHash })
  } catch (error) {
    compose("down", "-v", "--remove-orphans")
    throw error
  }

  return () => { compose("down", "-v", "--remove-orphans") }
}
