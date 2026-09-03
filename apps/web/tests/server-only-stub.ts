/**
 * Stands in for the `server-only` package under vitest.
 *
 * The real module throws on import so a server module can never be pulled into
 * a client bundle. That guard is worth keeping in the app and is pure noise in
 * a test runner, where there is no client boundary to cross.
 */
export {}
