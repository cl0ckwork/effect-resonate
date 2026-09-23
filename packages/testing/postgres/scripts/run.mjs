import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const postgresRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageRoot = dirname(postgresRoot)
const project = `effect-resonate-u7-${randomUUID().slice(0, 8)}`
const compose = (...args) => execFileSync("docker", ["compose", "-f", join(postgresRoot, "compose.yaml"), "-p", project, ...args], {
  cwd: postgresRoot,
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"]
})

const port = (service, containerPort) => {
  const address = compose("port", service, String(containerPort)).trim()
  const value = Number(address.slice(address.lastIndexOf(":") + 1))
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${service} port`)
  return value
}

try {
  compose("up", "-d", "--build", "--wait")
  const result = spawnSync(join(packageRoot, "node_modules", ".bin", "vitest"), [
    "run", "--config", join(packageRoot, "vitest.postgres.config.ts"), ...process.argv.slice(2)
  ], {
    cwd: packageRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      POSTGRES_E2E_PORT: String(port("postgres", 5432)),
      INTEGRESQL_E2E_PORT: String(port("integresql", 5000))
    }
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  compose("down", "-v", "--remove-orphans")
}
