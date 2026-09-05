import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    /*
     * An array, not an object, because order decides the winner and the
     * specific entries have to be tried before the `@` catch-all. As an object
     * `@` matched `@/lib/db/client` first and the stub below never applied.
     */
    alias: [
      /*
       * The database client opens a connection pool — and so validates the
       * whole environment — at import time. Without this stub a unit test for
       * a pure function fails to *load* on any machine without a populated
       * `.env`, which is every CI runner.
       *
       * Exact match: only the client is stubbed, not the schema or anything
       * else under `lib/db`. `vitest.integration.config.ts` deliberately omits
       * this, because those tests want the real client.
       */
      {
        find: /^@\/lib\/db\/client$/,
        replacement: fileURLToPath(new URL('./tests/db-client-stub.ts', import.meta.url)),
      },
      /*
       * `server-only` throws on import outside a React Server Component, which
       * is exactly what it is for — and it stops vitest loading any module that
       * carries the guard. Stub it so pure functions living in those files stay
       * testable without weakening the guard in the app.
       */
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
      },
      { find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    /*
     * A fake environment for the unit suite.
     *
     * `packages/shared/src/env.ts` validates everything the moment it is first
     * called, and several modules call it at import time — the logger does, so
     * anything that logs drags the whole schema in. The suite therefore refused
     * to *load* on a machine without a populated `.env`, which is every CI
     * runner, while passing on a developer's laptop. That is the worst shape a
     * test failure can take.
     *
     * These values are deliberately obvious nonsense. Nothing here connects to
     * anything: `@/lib/db/client` is stubbed above and throws if a test reaches
     * for the database. Real configuration is an integration-test concern, and
     * `vitest.integration.config.ts` does not use any of this.
     */
    env: {
      DATABASE_URL: 'postgres://unit-test:unit-test@127.0.0.1:1/unit-test',
      AUTH_SECRET: 'unit-test-auth-secret-not-a-real-secret-000000',
      WEBHOOK_SIGNING_SECRET: 'unit-test-webhook-secret-not-a-real-secret-0000',
      APP_URL: 'http://localhost:3000',
    },
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests need a live database and are run explicitly:
    //   pnpm test:integration
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    // The matcher suite must stay fast enough to run on every save.
    testTimeout: 10_000,
  },
})
