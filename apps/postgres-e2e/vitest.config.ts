import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const packageSrc = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@effect-resonate\/core\/(.*)$/, replacement: `${packageSrc("core")}$1.ts` },
      { find: /^@effect-resonate\/network-postgres\/(.*)$/, replacement: `${packageSrc("network-postgres")}$1.ts` },
      { find: /^@effect-resonate\/testing\/(.*)$/, replacement: `${packageSrc("testing")}$1.ts` },
      { find: "@effect-resonate/core", replacement: `${packageSrc("core")}index.ts` },
      { find: "@effect-resonate/network-postgres", replacement: `${packageSrc("network-postgres")}index.ts` },
      { find: "@effect-resonate/testing", replacement: `${packageSrc("testing")}index.ts` }
    ]
  },
  test: {
    include: ["src/**/__tests__/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000
  }
})
