/**
 * Stands in for `@/lib/db/client` under the unit test config.
 *
 * The real module opens a connection pool at import time, which means it reads
 * and validates the whole environment at import time. So a unit test for a pure
 * function — `shouldCapture`, `parseStatementCsv` — failed to *load* unless a
 * populated `.env` happened to be sitting on the machine running it.
 *
 * That is why `pnpm test` passed on a developer's laptop and failed the moment
 * CI ran it on a clean checkout. The tests were fine; the import graph was
 * reaching for a database nobody asked it for.
 *
 * Aliased in `vitest.config.ts` next to the `server-only` stub, for the same
 * reason and with the same limits: it applies to the unit suite only.
 * `vitest.integration.config.ts` does not use it, because those tests want the
 * real client and a real database.
 *
 * Anything that actually touches this at runtime will throw rather than
 * silently returning undefined — a unit test reaching the database is a test
 * that has outgrown this config, and it should say so loudly.
 */

const unavailable = (name: string) => () => {
  throw new Error(
    `The unit test suite stubs the database. \`${name}\` was called for real.\n` +
      'Mock the service under test, or move this to *.integration.test.ts.',
  )
}

export const db = new Proxy(
  {},
  {
    get: (_target, property) => unavailable(`db.${String(property)}`),
  },
)

export type Database = never
export type Tx = never
