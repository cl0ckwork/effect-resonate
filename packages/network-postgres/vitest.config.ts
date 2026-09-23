import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.unit.ts"],
    pool: "forks",
    maxWorkers: 2
  }
})
