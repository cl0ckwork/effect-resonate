#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { resolve, relative, sep } from "node:path"

const args = process.argv.slice(2)
const rootIndex = args.indexOf("--root")
const root = resolve(rootIndex === -1 ? process.cwd() : args[rootIndex + 1])
const printInvalidNames = args.includes("--invalid-names")

const collectFiles = async (directory, base = directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === ".git" || entry.name === "node_modules")) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(path, base))
    else if (entry.isFile()) files.push({ path, relativePath: relative(base, path).split(sep).join("/") })
  }
  return files
}

const hashDirectory = async (directory) => {
  const hash = createHash("sha256")
  const files = await collectFiles(directory)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update(await readFile(file.path))
  }
  return hash.digest("hex")
}

let lock
try {
  lock = JSON.parse(await readFile(resolve(root, "skills-lock.json"), "utf8"))
} catch {
  console.error("skills-lock.json is missing or malformed")
  process.exit(2)
}

if (lock.version !== 1 || typeof lock.skills !== "object" || lock.skills === null || Array.isArray(lock.skills)) {
  console.error("skills-lock.json has an unsupported shape")
  process.exit(2)
}

const invalid = []
for (const [name, record] of Object.entries(lock.skills)) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || typeof record !== "object" || record === null ||
      !/^[a-f0-9]{64}$/.test(record.computedHash ?? "")) {
    console.error(`skills-lock.json has an invalid entry for ${name}`)
    process.exit(2)
  }

  const directory = resolve(root, ".agents", "skills", name)
  try {
    if (!(await stat(resolve(directory, "SKILL.md"))).isFile() ||
        await hashDirectory(directory) !== record.computedHash) invalid.push(name)
  } catch {
    invalid.push(name)
  }
}

if (printInvalidNames) {
  for (const name of invalid) console.log(name)
} else if (invalid.length > 0) {
  console.error(`invalid repo-local skills: ${invalid.join(", ")}`)
}

process.exitCode = invalid.length > 0 ? 1 : 0
