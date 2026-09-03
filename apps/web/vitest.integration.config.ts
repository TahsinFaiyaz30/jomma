import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Integration tests. These talk to a real Postgres — start it with `pnpm db:up`
 * and migrate before running. Kept out of the default suite so `pnpm test` stays
 * runnable with no services up.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.integration.test.ts'],
    testTimeout: 30_000,
    // One database, shared state — running these in parallel would have them
    // fighting over the same rows.
    fileParallelism: false,
  },
})
