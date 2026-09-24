import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const temp = mkdtempSync(join(tmpdir(), "effect-resonate-pack-check-"))
const tarballs = join(temp, "tarballs")
const consumer = join(temp, "consumer")

try {
  mkdirSync(tarballs)
  mkdirSync(consumer)
  const packageTarball = (packageDirectory) => {
    const { name } = JSON.parse(readFileSync(join(root, packageDirectory, "package.json"), "utf8"))
    execFileSync("pnpm", ["pack", "--pack-destination", tarballs], {
      cwd: join(root, packageDirectory),
      stdio: "inherit"
    })
    const tarballPrefix = name.replace(/^@/, "").replaceAll("/", "-")
    const tarball = readdirSync(tarballs).find(
      (entry) => entry.endsWith(".tgz") && entry.startsWith(tarballPrefix)
    )
    if (!tarball) throw new Error(`pnpm pack did not create an archive for ${packageDirectory}`)
    return `file:${join(tarballs, tarball)}`
  }

  const core = packageTarball("packages/core")
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@effect-resonate/core": core,
          "@resonatehq/sdk": "^0.11.4",
          effect: "4.0.0-rc.115",
          typescript: "5.9.2"
        }
      },
      null,
      2
    )
  )
  writeFileSync(
    join(consumer, "consumer.mts"),
    [
      'import * as Core from "@effect-resonate/core"',
      'import * as Workflow from "@effect-resonate/core/Workflow"',
      'import * as Step from "@effect-resonate/core/Step"',
      'import * as Network from "@effect-resonate/core/ResonateNetwork"',
      "void [Core, Workflow, Step, Network]",
      ""
    ].join("\n")
  )

  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: consumer,
    stdio: "inherit"
  })
  execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      "await import('@effect-resonate/core'); try { import.meta.resolve('pg'); throw new Error('pg was installed for a core-only consumer') } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }"
    ],
    { cwd: consumer, stdio: "inherit" }
  )
  execFileSync(
    "npm",
    [
      "exec",
      "--",
      "tsc",
      "--noEmit",
      "--skipLibCheck",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "consumer.mts"
    ],
    { cwd: consumer, stdio: "inherit" }
  )
  execFileSync("npm", ["install", "pg@^8.11.0", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: consumer,
    stdio: "inherit"
  })
  writeFileSync(
    join(consumer, "postgres.mts"),
    [
      'import { PostgresNetwork } from "@resonatehq/sdk/postgres"',
      'import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"',
      'import { Effect } from "effect"',
      'const live = ResonateNetwork.layer(() => new PostgresNetwork({ connectionString: "postgres://localhost/resonate" }))',
      "const network = ResonateNetwork.ResonateNetwork.pipe(Effect.provide(live))",
      "void network",
      ""
    ].join("\n")
  )
  execFileSync(
    "npm",
    [
      "exec",
      "--",
      "tsc",
      "--noEmit",
      "--skipLibCheck",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "postgres.mts"
    ],
    { cwd: consumer, stdio: "inherit" }
  )
  execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      "const [{ PostgresNetwork }, ResonateNetwork, { Effect }] = await Promise.all([import('@resonatehq/sdk/postgres'), import('@effect-resonate/core/ResonateNetwork'), import('effect')]); const live = ResonateNetwork.layer(() => new PostgresNetwork({ connectionString: 'postgres://localhost/resonate' })); await Effect.runPromise(ResonateNetwork.ResonateNetwork.pipe(Effect.provide(live)))"
    ],
    { cwd: consumer, stdio: "inherit" }
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
