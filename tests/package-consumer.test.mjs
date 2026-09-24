import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const coreRoot = join(projectRoot, "packages", "core")
const postgresRoot = join(projectRoot, "packages", "network-postgres")

test("the packed core artifact typechecks from root and subpath imports", (context) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "effect-resonate-package-consumer-"))
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  execFileSync(join(coreRoot, "node_modules", ".bin", "zshy"), [], { cwd: coreRoot })
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", fixtureRoot], {
    cwd: coreRoot,
    encoding: "utf8"
  })
  const [{ filename }] = JSON.parse(packOutput)
  assert.equal(typeof filename, "string")

  const nodeModules = join(fixtureRoot, "node_modules")
  const packedCore = join(nodeModules, "@effect-resonate", "core")
  mkdirSync(packedCore, { recursive: true })
  execFileSync("tar", ["-xzf", join(fixtureRoot, filename), "-C", packedCore, "--strip-components=1"])

  symlinkSync(join(coreRoot, "node_modules", "effect"), join(nodeModules, "effect"), "dir")
  mkdirSync(join(nodeModules, "@resonatehq"), { recursive: true })
  symlinkSync(
    join(coreRoot, "node_modules", "@resonatehq", "sdk"),
    join(nodeModules, "@resonatehq", "sdk"),
    "dir"
  )

  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(join(fixtureRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true
    },
    files: ["consumer.ts"]
  }))
  writeFileSync(join(fixtureRoot, "consumer.ts"), `
import type { Context as SdkContext } from "@resonatehq/sdk/async"
import { Effect, Schema } from "effect"
import { ResonateClient, ResonateFunctions, Step, Workflow } from "@effect-resonate/core"
import * as CoreExecutionError from "@effect-resonate/core/CoreExecutionError"
import * as DurableValue from "@effect-resonate/core/DurableValue"
import * as Client from "@effect-resonate/core/ResonateClient"
import * as Functions from "@effect-resonate/core/ResonateFunctions"
import * as Network from "@effect-resonate/core/ResonateNetwork"
import * as StepModule from "@effect-resonate/core/Step"
import * as StepContext from "@effect-resonate/core/StepContext"
import * as WorkflowModule from "@effect-resonate/core/Workflow"
import type { WorkflowContext } from "@effect-resonate/core/WorkflowContext"

const Raw = async (_context: SdkContext, value: string) => ({ value })
declare const rawTarget: typeof Raw | string
declare const client: Client.ResonateClientService
declare const context: WorkflowContext

const TypedStep = Step.make({
  name: "consumer.step",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})
const TypedWorkflow = Workflow.make({
  name: "consumer.workflow",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})
const group = ResonateFunctions.make(TypedStep, TypedWorkflow)

const typed = client.run("typed-1", TypedWorkflow, "value")
const raw = client.run<{ readonly value: string }>("raw-1", rawTarget, "value")
const accessor = ResonateClient.rpc<{ readonly value: string }>("raw-2", Raw, "value")
const directAccessor = Client.run<{ readonly value: string }>("raw-3", rawTarget, "value")
const child = context.run(TypedStep, "value")

void [
  Effect.succeed(group),
  typed,
  raw,
  accessor,
  directAccessor,
  child,
  CoreExecutionError,
  DurableValue,
  Functions,
  Network,
  StepModule,
  StepContext,
  WorkflowModule
]
`)

  execFileSync(join(coreRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })

  const packedManifest = JSON.parse(readFileSync(join(packedCore, "package.json"), "utf8"))
  assert.ok(packedManifest.exports["./ResonateClient"])
})

test("the packed Postgres provider typechecks from root and subpath imports", (context) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "effect-resonate-postgres-consumer-"))
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  execFileSync(join(coreRoot, "node_modules", ".bin", "zshy"), [], { cwd: coreRoot })
  execFileSync(join(postgresRoot, "node_modules", ".bin", "zshy"), [], { cwd: postgresRoot })

  const pack = (packageRoot) => {
    const output = execFileSync("npm", ["pack", "--json", "--pack-destination", fixtureRoot], {
      cwd: packageRoot,
      encoding: "utf8"
    })
    const [{ filename }] = JSON.parse(output)
    assert.equal(typeof filename, "string")
    return join(fixtureRoot, filename)
  }

  const nodeModules = join(fixtureRoot, "node_modules")
  const packedCore = join(nodeModules, "@effect-resonate", "core")
  const packedPostgres = join(nodeModules, "@effect-resonate", "network-postgres")
  for (const [archive, destination] of [
    [pack(coreRoot), packedCore],
    [pack(postgresRoot), packedPostgres]
  ]) {
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    assert.doesNotMatch(entries, /__tests__|\.types\.js/)
    mkdirSync(destination, { recursive: true })
    execFileSync("tar", ["-xzf", archive, "-C", destination, "--strip-components=1"])
  }

  symlinkSync(join(coreRoot, "node_modules", "effect"), join(nodeModules, "effect"), "dir")
  mkdirSync(join(nodeModules, "@resonatehq"), { recursive: true })
  symlinkSync(join(coreRoot, "node_modules", "@resonatehq", "sdk"), join(nodeModules, "@resonatehq", "sdk"), "dir")
  symlinkSync(join(postgresRoot, "node_modules", "pg"), join(nodeModules, "pg"), "dir")

  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(join(fixtureRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true
    },
    files: ["consumer.ts"]
  }))
  writeFileSync(join(fixtureRoot, "consumer.ts"), `
import * as Postgres from "@effect-resonate/network-postgres"
import { layer } from "@effect-resonate/network-postgres/PostgresNetwork"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { Layer } from "effect"

const network = Postgres.layer({ connectionString: "postgres://localhost/resonate" })
const client = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(Layer.provide(network))
const subpath = layer({ connectionString: "postgres://localhost/resonate", tickMs: 250 })
void [client, subpath]
`)

  execFileSync(join(coreRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })
  execFileSync("node", ["--input-type=module", "-e", "await import('@effect-resonate/network-postgres')"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })

  const coreManifest = JSON.parse(readFileSync(join(packedCore, "package.json"), "utf8"))
  const providerManifest = JSON.parse(readFileSync(join(packedPostgres, "package.json"), "utf8"))
  assert.equal(coreManifest.peerDependencies.pg, undefined)
  assert.equal(providerManifest.peerDependencies.pg, "^8.11.0")
  assert.ok(providerManifest.exports["./PostgresNetwork"])
  assert.equal(providerManifest.dependencies?.["@effect-resonate/testing"], undefined)
})
