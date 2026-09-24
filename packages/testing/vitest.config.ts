import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@effect-resonate\/core$/,
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url))
      },
      {
        find: /^@effect-resonate\/core\/(.*)$/,
        replacement: `${fileURLToPath(new URL("../core/src/", import.meta.url))}$1.ts`
      }
    ]
  },
  test: {
    include: [
      "src/**/__tests__/**/*.unit.ts",
      "src/**/__tests__/**/*.integration.ts"
    ]
  }
})
