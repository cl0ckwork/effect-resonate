import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const coreRoot = join(projectRoot, "packages", "core")

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
  const packedEntries = execFileSync("tar", ["-tzf", join(fixtureRoot, filename)], {
    encoding: "utf8"
  })
  assert.doesNotMatch(packedEntries, /__tests__|\.types\.js|postgres|testing/i)
  assert.match(packedEntries, /package\/LICENSE\n/)

  const nodeModules = join(fixtureRoot, "node_modules")
  const packedCore = join(nodeModules, "@effect-resonate", "core")
  mkdirSync(packedCore, { recursive: true })
  execFileSync("tar", [
    "-xzf",
    join(fixtureRoot, filename),
    "-C",
    packedCore,
    "--strip-components=1"
  ])

  symlinkSync(join(coreRoot, "node_modules", "effect"), join(nodeModules, "effect"), "dir")
  mkdirSync(join(nodeModules, "@resonatehq"), { recursive: true })
  symlinkSync(
    join(coreRoot, "node_modules", "@resonatehq", "sdk"),
    join(nodeModules, "@resonatehq", "sdk"),
    "dir"
  )

  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(
    join(fixtureRoot, "tsconfig.json"),
    JSON.stringify({
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
    })
  )
  writeFileSync(
    join(fixtureRoot, "consumer.ts"),
    `
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
`
  )

  execFileSync(join(coreRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })
  execFileSync("node", ["--input-type=module", "-e", "await import('@effect-resonate/core')"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })

  const packedManifest = JSON.parse(readFileSync(join(packedCore, "package.json"), "utf8"))
  assert.ok(packedManifest.exports["./ResonateClient"])
  assert.ok(packedManifest.exports["./ResonateNetwork"])
  assert.equal(packedManifest.exports["./PostgresNetwork"], undefined)
  assert.equal(packedManifest.peerDependencies.pg, undefined)
  assert.equal(packedManifest.dependencies?.["@effect-resonate/testing"], undefined)
})

test("the packed core network factory composes with the SDK Postgres network", (context) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "effect-resonate-postgres-consumer-"))
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  execFileSync(join(coreRoot, "node_modules", ".bin", "zshy"), [], { cwd: coreRoot })
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", fixtureRoot], {
    cwd: coreRoot,
    encoding: "utf8"
  })
  const [{ filename }] = JSON.parse(output)
  assert.equal(typeof filename, "string")

  const archive = join(fixtureRoot, filename)
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
  assert.doesNotMatch(entries, /__tests__|\.types\.js/)
  assert.match(entries, /package\/LICENSE\n/)
  writeFileSync(
    join(fixtureRoot, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "@effect-resonate/core": `file:${archive}`,
        "@resonatehq/sdk": "^0.11.4",
        effect: "4.0.0-rc.115",
        pg: "^8.11.0",
        typescript: "5.9.2"
      }
    })
  )
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })
  writeFileSync(
    join(fixtureRoot, "tsconfig.json"),
    JSON.stringify({
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
    })
  )
  writeFileSync(
    join(fixtureRoot, "consumer.ts"),
    `
import { PostgresNetwork } from "@resonatehq/sdk/postgres"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"
import { Layer } from "effect"

const network = ResonateNetwork.layer(() => new PostgresNetwork({ connectionString: "postgres://localhost/resonate" }))
const client = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(Layer.provide(network))
void client
`
  )

  execFileSync("npm", ["exec", "--", "tsc", "-p", "tsconfig.json"], {
    cwd: fixtureRoot,
    stdio: "inherit"
  })
  execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      "const [{ PostgresNetwork }, ResonateNetwork, { Effect }] = await Promise.all([import('@resonatehq/sdk/postgres'), import('@effect-resonate/core/ResonateNetwork'), import('effect')]); const live = ResonateNetwork.layer(() => new PostgresNetwork({ connectionString: 'postgres://localhost/resonate' })); await Effect.runPromise(ResonateNetwork.ResonateNetwork.pipe(Effect.provide(live)))"
    ],
    {
      cwd: fixtureRoot,
      stdio: "inherit"
    }
  )

  const coreManifest = JSON.parse(
    readFileSync(
      join(fixtureRoot, "node_modules", "@effect-resonate", "core", "package.json"),
      "utf8"
    )
  )
  assert.ok(coreManifest.exports["./ResonateNetwork"])
  assert.equal(coreManifest.exports["./PostgresNetwork"], undefined)
  assert.equal(coreManifest.dependencies?.["@effect-resonate/testing"], undefined)
})
