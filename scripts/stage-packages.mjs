import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const stageCli = process.env.NPM_STAGE_CLI
const packagePaths = ["packages/core"]
const packages = packagePaths
  .map((directory) => ({
    directory,
    ...JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"))
  }))
  .filter(({ private: isPrivate }) => !isPrivate)
const checkOnly = process.argv.includes("--check")

const npmView = (spec) => {
  try {
    return execFileSync(
      "npm",
      ["view", spec, "version", "--json", "--registry", "https://registry.npmjs.org/"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    ).trim()
  } catch (error) {
    const detail = `${error.stdout ?? ""}\n${error.stderr ?? ""}`
    if (detail.includes("E404") || detail.includes("404 Not Found")) return undefined
    throw new Error(`Unable to check npm registry for ${spec}: ${detail}`, { cause: error })
  }
}

const missingPackages = packages.filter(({ name }) => npmView(name) === undefined)
if (missingPackages.length > 0) {
  console.log(
    `Skipping automated staging until ${missingPackages[0].name} has been bootstrapped on npm.`
  )
}

const unpublishedPackages =
  missingPackages.length > 0
    ? []
    : packages.filter(({ name, version }) => {
        if (version === "0.0.0") {
          console.log(
            `Skipping ${name}@${version}; it has not received its first Changesets version bump.`
          )
          return false
        }
        if (npmView(`${name}@${version}`) !== undefined) {
          console.log(`${name}@${version} is already published.`)
          return false
        }
        return true
      })

if (checkOnly) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `should_stage=${unpublishedPackages.length > 0}\n`)
  }
  process.exit(0)
}

const staged = []
for (const { directory, name, version } of unpublishedPackages) {
  try {
    const output = execFileSync(
      stageCli ? process.execPath : "npm",
      [
        ...(stageCli ? [stageCli] : []),
        "stage",
        "publish",
        "--access",
        "public",
        "--provenance",
        "--registry",
        "https://registry.npmjs.org/"
      ],
      {
        cwd: join(root, directory),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    )
    process.stdout.write(output)
  } catch (error) {
    const detail = `${error.stdout ?? ""}\n${error.stderr ?? ""}`
    throw new Error(
      `Unable to stage ${name}@${version}: ${detail}\nCheck npm's staged versions before rerunning or approving this release.`,
      { cause: error }
    )
  }
  staged.push(`${name}@${version}`)
}

if (staged.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## npm version awaiting approval",
      "",
      ...staged.map((spec) => `- \`${spec}\``),
      "",
      "Review the staged package on npmjs.com or with `npm stage list`, then approve with 2FA.",
      "",
      "This version is not public until approved.",
      ""
    ].join("\n")
  )
}
