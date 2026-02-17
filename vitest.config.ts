/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ["./test/setup.ts"],
    execArgv: ["--expose-gc"]
  }
})
