import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` throws on import outside a React Server Component, which
      // is exactly what it is for — and it stops vitest loading any module that
      // carries the guard. Stub it so pure functions living in those files stay
      // testable without weakening the guard in the app.
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests need a live database and are run explicitly:
    //   pnpm test:integration
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    // The matcher suite must stay fast enough to run on every save.
    testTimeout: 10_000,
  },
})
