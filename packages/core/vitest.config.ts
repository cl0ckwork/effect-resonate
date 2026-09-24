import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "src/**/__tests__/**/*.unit.ts",
      "src/**/__tests__/**/*.integration.ts"
    ]
  }
})
