import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const packagePaths = ["packages/core", "packages/network-postgres"]
const packages = packagePaths
  .map((directory) => ({
    directory,
    ...JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"))
  }))
  .filter(({ private: isPrivate }) => !isPrivate)

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
    `Skipping automated staging until all packages have been bootstrapped on npm: ${missingPackages.map(({ name }) => name).join(", ")}`
  )
  process.exit(0)
}

const staged = []
for (const { directory, name, version } of packages) {
  if (version === "0.0.0") {
    console.log(
      `Skipping ${name}@${version}; it has not received its first Changesets version bump.`
    )
    continue
  }
  if (npmView(`${name}@${version}`) !== undefined) {
    console.log(`${name}@${version} is already published.`)
    continue
  }
  try {
    const output = execFileSync(
      "npm",
      [
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
    if (
      !/already (been )?staged|staged version|E409|EPUBLISHCONFLICT|previously published/i.test(
        detail
      )
    ) {
      throw new Error(`Unable to stage ${name}@${version}: ${detail}`, { cause: error })
    }
    console.log(`${name}@${version} is already staged.`)
  }
  staged.push(`${name}@${version}`)
}

if (staged.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## npm versions awaiting approval",
      "",
      ...staged.map((spec) => `- \`${spec}\``),
      "",
      "Review each staged package on npmjs.com or with `npm stage list`, then approve with 2FA.",
      "",
      "These versions are not public until approved.",
      ""
    ].join("\n")
  )
}
