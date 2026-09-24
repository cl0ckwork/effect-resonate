import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

const [mode, base = process.env.FORMAT_BASE] = process.argv.slice(2)

if (!["--check", "--write"].includes(mode) || !base) {
  console.error("Usage: format-changed.mjs <--check|--write> <base-ref>")
  process.exit(2)
}

const reference = /^0+$/.test(base) ? "HEAD^" : base
if (mode === "--check") {
  execFileSync("git", ["diff", "--check", `${reference}...HEAD`], { stdio: "inherit" })
  execFileSync("git", ["diff", "--check", "HEAD"], { stdio: "inherit" })
}
const gitNames = (args) => execFileSync("git", args).toString("utf8").split("\0").filter(Boolean)
const names = [
  ...new Set([
    ...gitNames(["diff", "--name-only", "-z", "--diff-filter=ACMRT", `${reference}...HEAD`]),
    ...gitNames(["diff", "--name-only", "-z", "--diff-filter=ACMRT", "HEAD"]),
    ...gitNames(["ls-files", "--others", "--exclude-standard", "-z"])
  ])
].filter(existsSync)

if (names.length === 0) {
  console.log("No changed files to format.")
  process.exit(0)
}

execFileSync("pnpm", ["exec", "prettier", mode, "--ignore-unknown", ...names], {
  stdio: "inherit"
})
