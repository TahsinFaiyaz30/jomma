import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The environment is the last thing between a correct deploy and a confusing
 * one. These are the values whose absence fails *quietly* somewhere else, which
 * is exactly the kind of failure worth catching at boot.
 *
 * dotenv is stubbed out. Without this the loader reads the repo's own `.env`
 * and fills back in every variable a test just cleared, so the suite would pass
 * or fail depending on an untracked file on somebody's laptop.
 */
vi.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }))

const { env, resetEnvCache } = await import('./env')

const VALID = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/jomma',
  AUTH_SECRET: 'a'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'b'.repeat(32),
}

const original = { ...process.env }

function withEnv(vars: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key]
  // Assigning `undefined` to process.env stores the *string* "undefined", which
  // sails through a min(1) check. Absent has to mean absent.
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value
  }
  resetEnvCache()
}

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, original)
  resetEnvCache()
})

describe('secrets', () => {
  it('accepts a fully configured environment', () => {
    withEnv(VALID)
    expect(env().DATABASE_URL).toBe(VALID.DATABASE_URL)
  })

  it('refuses to boot without a database', () => {
    withEnv({ ...VALID, DATABASE_URL: undefined })
    expect(() => env()).toThrow(/DATABASE_URL/)
  })

  it('refuses a database url that is not one', () => {
    // What an unset shell variable expands to, and what a half-pasted
    // connection string looks like. Both used to boot and fail on first query.
    for (const value of ['undefined', 'localhost:5432', 'mysql://host/db']) {
      withEnv({ ...VALID, DATABASE_URL: value })
      expect(() => env(), value).toThrow(/postgres/)
    }
  })

  it('refuses a short signing secret', () => {
    // 31 characters. A secret that is nearly long enough is not long enough,
    // and a payments service should say so rather than start.
    withEnv({ ...VALID, WEBHOOK_SIGNING_SECRET: 'b'.repeat(31) })
    expect(() => env()).toThrow(/WEBHOOK_SIGNING_SECRET/)
  })

  it('refuses a short auth secret', () => {
    withEnv({ ...VALID, AUTH_SECRET: 'short' })
    expect(() => env()).toThrow(/AUTH_SECRET/)
  })

  it('lists every problem at once rather than one per restart', () => {
    withEnv({ DATABASE_URL: undefined, AUTH_SECRET: undefined, WEBHOOK_SIGNING_SECRET: undefined })
    const message = (() => {
      try {
        env()
        return ''
      } catch (error) {
        return String(error)
      }
    })()

    expect(message).toMatch(/DATABASE_URL/)
    expect(message).toMatch(/AUTH_SECRET/)
    expect(message).toMatch(/WEBHOOK_SIGNING_SECRET/)
  })
})

describe('APP_URL in production', () => {
  it('defaults to localhost in development', () => {
    withEnv(VALID)
    expect(env().APP_URL).toBe('http://localhost:3000')
  })

  /*
   * The one that matters. Inheriting the localhost default in production breaks
   * sign-in, device provisioning and webhook delivery — each of them silently,
   * and none of them obviously pointing back at this variable.
   */
  it('refuses to boot in production when it was never set', () => {
    withEnv({ ...VALID, NODE_ENV: 'production' })
    expect(() => env()).toThrow(/APP_URL/)
  })

  it('accepts a real URL in production', () => {
    withEnv({ ...VALID, NODE_ENV: 'production', APP_URL: 'https://pay.example.com' })
    expect(env().APP_URL).toBe('https://pay.example.com')
  })

  it('still allows a deliberate localhost, for testing a production build', () => {
    withEnv({ ...VALID, NODE_ENV: 'production', APP_URL: 'http://localhost:3010' })
    expect(env().APP_URL).toBe('http://localhost:3010')
  })

  it('rejects a value that is not an absolute URL', () => {
    withEnv({ ...VALID, NODE_ENV: 'production', APP_URL: 'pay.example.com' })
    expect(() => env()).toThrow(/absolute URL/)
  })

  it('rejects a non-http scheme', () => {
    withEnv({ ...VALID, NODE_ENV: 'production', APP_URL: 'ftp://pay.example.com' })
    expect(() => env()).toThrow(/http or https/)
  })
})
