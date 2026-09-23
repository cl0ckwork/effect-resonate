import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const source = (name: string) => fileURLToPath(new URL(`../${name}/src/`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@effect-resonate\/core\/(.*)$/, replacement: `${source("core")}$1.ts` },
      { find: /^@effect-resonate\/network-postgres\/(.*)$/, replacement: `${source("network-postgres")}$1.ts` },
      { find: "@effect-resonate/core", replacement: `${source("core")}index.ts` },
      { find: "@effect-resonate/network-postgres", replacement: `${source("network-postgres")}index.ts` }
    ]
  },
  test: {
    include: ["postgres/src/**/__tests__/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000
  }
})
