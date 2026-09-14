import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const temporaryRoots = []

test.after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true })
})

const makeRepository = ({ worktreeScript = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "effect-resonate-tooling-"))
  temporaryRoots.push(root)
  execFileSync("git", ["init", "--quiet", root])
  mkdirSync(join(root, "scripts"), { recursive: true })
  for (const name of ["setup-agent-symlinks.sh", "doctor", "check-skills.mjs", ...(worktreeScript ? ["worktree-up", "restore-skills"] : [])]) {
    cpSync(join(projectRoot, "scripts", name), join(root, "scripts", name))
    chmodSync(join(root, "scripts", name), 0o755)
  }
  return root
}

const addAgentConfig = (root) => {
  mkdirSync(join(root, ".agents", "skills", "example"), { recursive: true })
  mkdirSync(join(root, ".agents", "agents"), { recursive: true })
  writeFileSync(join(root, ".agents", "AGENTS.md"), "root instructions\n")
  writeFileSync(join(root, ".agents", "skills", "example", "SKILL.md"), "example\n")
  writeFileSync(join(root, ".agents", "agents", "reviewer.md"), "reviewer\n")
}

const run = (root, script, args = [], env = {}) => spawnSync("bash", [script, ...args], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, ...env }
})

const makePnpmStub = (root, marker) => {
  const bin = join(root, "stub-bin")
  mkdirSync(bin)
  const pnpm = join(bin, "pnpm")
  writeFileSync(pnpm, `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  if [[ -n "${marker ?? ""}" && ( "$PWD" != "/" || "\${npm_config_manage_package_manager_versions:-}" != "false" ) ]]; then
    : > "${marker ?? ""}"
  fi
  echo 12.4.1
elif [[ "\${1:-}" == "install" ]]; then
  mkdir -p node_modules/.pnpm node_modules/effect
  : > node_modules/effect/AGENTS.md
else
  exit 2
fi
`)
  chmodSync(pnpm, 0o755)
  return bin
}

const skillHash = (contents) => createHash("sha256").update("SKILL.md").update(contents).digest("hex")

const makeSkillsInstallerStub = (root, { interruptSecondMove = false } = {}) => {
  const bin = join(root, "installer-bin")
  mkdirSync(bin)
  const npx = join(bin, "npx")
  writeFileSync(npx, `#!/usr/bin/env bash
[[ "\${1:-}" == "--yes" && "\${2:-}" == "skills@1.5.26" && "\${3:-}" == "experimental_install" ]] || exit 2
mkdir -p .agents/skills/example
printf 'restored\\n' > .agents/skills/example/SKILL.md
`)
  chmodSync(npx, 0o755)
  if (interruptSecondMove) {
    const mv = join(bin, "mv")
    const counter = join(root, "mv-count")
    writeFileSync(mv, `#!/usr/bin/env bash
count=$(cat "${counter}" 2>/dev/null || echo 0)
count=$((count + 1))
printf '%s\\n' "$count" > "${counter}"
if [[ $count -eq 2 ]]; then
  kill -TERM "$PPID"
  exit 1
fi
exec /bin/mv "$@"
`)
    chmodSync(mv, 0o755)
  }
  return bin
}

test("agent links are created with relative targets and setup is idempotent", () => {
  const root = makeRepository()
  addAgentConfig(root)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = run(root, "scripts/setup-agent-symlinks.sh")
    assert.equal(result.status, 0, result.stderr)
  }

  assert.equal(readlinkSync(join(root, "AGENTS.md")), ".agents/AGENTS.md")
  assert.equal(readlinkSync(join(root, ".claude", "skills")), "../.agents/skills")
  assert.equal(readlinkSync(join(root, ".codex", "skills")), "../.agents/skills")
})

test("agent link setup refuses and preserves an existing real destination", () => {
  const root = makeRepository()
  addAgentConfig(root)
  mkdirSync(join(root, ".claude", "skills"), { recursive: true })
  writeFileSync(join(root, ".claude", "skills", "keep.txt"), "keep me\n")

  const result = run(root, "scripts/setup-agent-symlinks.sh")

  assert.equal(result.status, 1)
  assert.match(result.stderr, /refusing to replace \.claude\/skills/)
  assert.equal(readFileSync(join(root, ".claude", "skills", "keep.txt"), "utf8"), "keep me\n")
})

test("nested agent overlays prefer local entries and concatenate instructions", () => {
  const root = makeRepository()
  addAgentConfig(root)
  mkdirSync(join(root, ".agents", "skills", "shared"), { recursive: true })
  writeFileSync(join(root, ".agents", "skills", "shared", "origin"), "root\n")

  const nested = join(root, "packages", "feature")
  mkdirSync(join(nested, ".agents", "skills", "shared"), { recursive: true })
  mkdirSync(join(nested, ".agents", "skills", "local-only"), { recursive: true })
  writeFileSync(join(nested, ".agents", "AGENTS.md"), "local instructions\n")
  writeFileSync(join(nested, ".agents", "skills", "shared", "origin"), "local\n")

  const result = run(nested, resolve(root, "scripts/setup-agent-symlinks.sh"), [], {
    EFFECT_RESONATE_ROOT_DIR: root
  })

  assert.equal(result.status, 0, result.stderr)
  const combined = join(nested, ".agents", ".combined")
  assert.equal(readFileSync(join(combined, "AGENTS.md"), "utf8"), "root instructions\n\n\nlocal instructions\n")
  assert.equal(readFileSync(join(combined, "skills", "shared", "origin"), "utf8"), "local\n")
  assert.equal(resolve(join(nested, ".claude"), readlinkSync(join(nested, ".claude", "skills"))), join(combined, "skills"))
})

const prepareDoctorRepository = ({ pnpmProbeMarker } = {}) => {
  const root = makeRepository()
  addAgentConfig(root)
  writeFileSync(join(root, "skills-lock.json"), '{"version":1,"skills":{}}\n')
  writeFileSync(join(root, "package.json"), '{"packageManager":"pnpm@12.4.1"}\n')
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true })
  mkdirSync(join(root, "node_modules", "effect"), { recursive: true })
  writeFileSync(join(root, "node_modules", "effect", "AGENTS.md"), "effect\n")
  const pnpmHome = makePnpmStub(root, pnpmProbeMarker)
  assert.equal(run(root, "scripts/setup-agent-symlinks.sh").status, 0)
  return { root, pnpmHome }
}

test("doctor succeeds for a ready repository", () => {
  const { root, pnpmHome } = prepareDoctorRepository()
  const result = run(root, "scripts/doctor", ["--no-wait"], { PNPM_HOME: pnpmHome })

  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /All readiness checks passed/)
})

test("doctor diagnoses a malformed skills lock", () => {
  const { root, pnpmHome } = prepareDoctorRepository()
  writeFileSync(join(root, "skills-lock.json"), "not json\n")
  const result = run(root, "scripts/doctor", ["--no-wait"], { PNPM_HOME: pnpmHome })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /skills-lock\.json is malformed or unsupported/)
  assert.match(result.stdout, /1 readiness error/)
})

test("doctor detects a locked skill whose contents were modified", () => {
  const { root, pnpmHome } = prepareDoctorRepository()
  writeFileSync(join(root, "skills-lock.json"), JSON.stringify({
    version: 1,
    skills: { example: { computedHash: "0".repeat(64) } }
  }))
  const result = run(root, "scripts/doctor", ["--no-wait"], { PNPM_HOME: pnpmHome })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /repo-local skills missing or modified: example/)
})

test("doctor probes pnpm outside the repository with version management disabled", () => {
  const marker = join(tmpdir(), `unsafe-pnpm-probe-${process.pid}-${Date.now()}`)
  const { root, pnpmHome } = prepareDoctorRepository({ pnpmProbeMarker: marker })
  temporaryRoots.push(marker)
  const result = run(root, "scripts/doctor", ["--no-wait"], { PNPM_HOME: pnpmHome })

  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(marker), false)
})

test("skill restoration validates staged content before replacing a modified skill", () => {
  const root = makeRepository({ worktreeScript: true })
  addAgentConfig(root)
  writeFileSync(join(root, "skills-lock.json"), JSON.stringify({
    version: 1,
    skills: { example: { computedHash: skillHash("restored\n") } }
  }))
  const installerBin = makeSkillsInstallerStub(root)

  const result = run(root, "scripts/restore-skills", [], { PATH: `${installerBin}:${process.env.PATH}` })

  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(readFileSync(join(root, ".agents", "skills", "example", "SKILL.md"), "utf8"), "restored\n")
  assert.equal(existsSync(join(root, ".agents", ".skill-restore")), false)
})

test("interrupted skill replacement restores the previous skill", () => {
  const root = makeRepository({ worktreeScript: true })
  addAgentConfig(root)
  writeFileSync(join(root, "skills-lock.json"), JSON.stringify({
    version: 1,
    skills: { example: { computedHash: skillHash("restored\n") } }
  }))
  const installerBin = makeSkillsInstallerStub(root, { interruptSecondMove: true })

  const result = run(root, "scripts/restore-skills", [], { PATH: `${installerBin}:${process.env.PATH}` })

  assert.equal(result.status, 143, result.stdout + result.stderr)
  assert.equal(readFileSync(join(root, ".agents", "skills", "example", "SKILL.md"), "utf8"), "example\n")
})

test("worktree bootstrap recovers a dead-owner lock and cleans up its lock", () => {
  const root = makeRepository({ worktreeScript: true })
  addAgentConfig(root)
  writeFileSync(join(root, "skills-lock.json"), '{"version":1,"skills":{}}\n')
  writeFileSync(join(root, "package.json"), '{"packageManager":"pnpm@12.4.1"}\n')
  const pnpmHome = makePnpmStub(root)
  const lock = join(root, ".git", "effect-resonate-bootstrap.lock")
  mkdirSync(lock)
  const host = execFileSync("hostname", { encoding: "utf8" }).trim()
  writeFileSync(join(lock, "owner"), `${host}:999999999:0\n`)

  const result = run(root, "scripts/worktree-up", [], {
    PNPM_HOME: pnpmHome,
    PATH: `${pnpmHome}:${process.env.PATH}`
  })

  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /removing lock owned by dead process/)
  assert.equal(existsSync(lock), false)
  assert.match(result.stdout, /All readiness checks passed/)
})
