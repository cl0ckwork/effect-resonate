import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const fixture = (context, version = "0.1.0") => {
  const root = mkdtempSync(join(tmpdir(), "effect-resonate-stage-test-"))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const scripts = join(root, "scripts")
  const bin = join(root, "bin")
  mkdirSync(scripts)
  mkdirSync(bin)
  copyFileSync(
    join(projectRoot, "scripts", "stage-packages.mjs"),
    join(scripts, "stage-packages.mjs")
  )
  const packageDirectory = join(root, "packages", "core")
  mkdirSync(packageDirectory, { recursive: true })
  writeFileSync(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name: "@effect-resonate/core", version })
  )
  const calls = join(root, "calls.jsonl")
  const summary = join(root, "summary.md")
  const output = join(root, "output.txt")
  writeFileSync(calls, "")
  writeFileSync(summary, "")
  writeFileSync(output, "")
  const npm = join(bin, "npm")
  writeFileSync(
    npm,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + "\\n")
if (args[0] === "view") {
  if (process.env.SCENARIO === "registry-error") {
    process.stderr.write("npm error E500 registry unavailable\\n")
    process.exit(1)
  }
  if (process.env.SCENARIO === "missing-package" && args[1] === "@effect-resonate/core") {
    process.stderr.write("npm error E404 Not Found\\n")
    process.exit(1)
  }
  if (args[1].endsWith("@0.1.0") && process.env.SCENARIO !== "already-live") {
    process.stderr.write("npm error E404 Not Found\\n")
    process.exit(1)
  }
  process.stdout.write('"0.1.0"\\n')
  process.exit(0)
}
if (args[0] === "stage" && process.env.SCENARIO === "stage-conflict") {
  process.stderr.write("npm error E409 already staged\\n")
  process.exit(1)
}
if (args[0] === "stage" && process.env.SCENARIO === "stage-failure") {
  process.stderr.write("npm error EACCES permission denied\\n")
  process.exit(1)
}
if (args[0] === "stage") process.stdout.write("staged\\n")
`
  )
  chmodSync(npm, 0o755)

  return (scenario, checkOnly = false) => {
    const args = [join(scripts, "stage-packages.mjs"), ...(checkOnly ? ["--check"] : [])]
    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: calls,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        SCENARIO: scenario
      }
    })
    const invoked = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    return {
      ...result,
      invoked,
      output: readFileSync(output, "utf8"),
      summary: readFileSync(summary, "utf8")
    }
  }
}

test("stage check skips the protected deployment when the version is live", (context) => {
  const result = fixture(context)("already-live", true)
  assert.equal(result.status, 0)
  assert.equal(result.output, "should_stage=false\n")
  assert.equal(
    result.invoked.some(([command]) => command === "stage"),
    false
  )
})

test("stage check requests a protected deployment for an unpublished version", (context) => {
  const result = fixture(context)("new-version", true)
  assert.equal(result.status, 0)
  assert.equal(result.output, "should_stage=true\n")
  assert.equal(
    result.invoked.some(([command]) => command === "stage"),
    false
  )
})

test("stage check waits for the first manual npm publish", (context) => {
  const result = fixture(context)("missing-package", true)
  assert.equal(result.status, 0)
  assert.equal(result.output, "should_stage=false\n")
})

test("staging waits until core exists on npm", (context) => {
  const result = fixture(context)("missing-package")
  assert.equal(result.status, 0)
  assert.equal(
    result.invoked.some(([command]) => command === "stage"),
    false
  )
  assert.match(result.stdout, /Skipping automated staging/)
})

test("staging skips versions already live on npm", (context) => {
  const result = fixture(context)("already-live")
  assert.equal(result.status, 0)
  assert.equal(
    result.invoked.some(([command]) => command === "stage"),
    false
  )
})

test("staging skips the unreleased version sentinel", (context) => {
  const result = fixture(context, "0.0.0")("new-version")
  assert.equal(result.status, 0)
  assert.equal(
    result.invoked.some(([command]) => command === "stage"),
    false
  )
})

test("staging records the core version awaiting approval", (context) => {
  const result = fixture(context)("new-version")
  assert.equal(result.status, 0)
  const stageCalls = result.invoked.filter(([command]) => command === "stage")
  assert.equal(stageCalls.length, 1)
  for (const args of stageCalls) {
    assert.ok(args.includes("--provenance"))
    assert.ok(args.includes("https://registry.npmjs.org/"))
  }
  assert.match(result.summary, /@effect-resonate\/core@0\.1\.0/)
  assert.doesNotMatch(result.summary, /network-postgres/)
})

test("staging stops on a conflict whose exact staged version cannot be verified", (context) => {
  const result = fixture(context)("stage-conflict")
  assert.notEqual(result.status, 0)
  const stageCalls = result.invoked.filter(([command]) => command === "stage")
  assert.equal(stageCalls.length, 1)
  assert.match(result.stderr, /Unable to stage @effect-resonate\/core@0\.1\.0/)
  assert.match(result.stderr, /Check npm's staged versions/)
  assert.equal(result.summary, "")
})

test("unexpected npm staging failures stop the release", (context) => {
  const result = fixture(context)("stage-failure")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /EACCES/)
})

test("registry lookup failures stop the release", (context) => {
  const result = fixture(context)("registry-error")
  assert.notEqual(result.status, 0)
  assert.equal(
    result.invoked.some(([command]) => command === "stage"),
    false
  )
  assert.match(result.stderr, /E500/)
})
