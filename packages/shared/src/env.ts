import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

/**
 * Env is loaded from a single `.env` at the repo root, not per-app, so `web` and
 * `worker` can never drift apart on a secret. Next only auto-loads a `.env` next
 * to the app it is serving, so we walk up to find the workspace root ourselves.
 *
 * Server-only. Never import this from a client component.
 */

function findRepoRoot(from: string): string | null {
  let dir = from
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

let loaded = false
function ensureDotenvLoaded(): void {
  if (loaded) return
  loaded = true
  const root = findRepoRoot(process.cwd())
  if (!root) return
  // `override: false` — a real process env (docker, CI) always wins over the file.
  for (const file of ['.env.local', '.env']) {
    const path = join(root, file)
    if (existsSync(path)) loadDotenv({ path, override: false, quiet: true })
  }
}

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const int = (fallback: number) => z.coerce.number().int().catch(fallback).default(fallback)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Checked for shape, not just presence. `min(1)` accepted anything at all,
   * including a shell that expanded an unset variable to the literal string
   * "undefined" — which then failed much later, on the first query, as a
   * connection error that named nothing useful.
   */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — see .env.example')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must start with postgres:// or postgresql://',
    ),
  DATABASE_POOL_MAX: int(10),

  /**
   * The instance's own public URL.
   *
   * The localhost default is right for development and dangerous in
   * production, so `requireProductionAppUrl` below rejects a deploy that
   * forgot it. Three things read this and all three fail quietly on the wrong
   * value: Better Auth's origin check (sign-in fails looking like a wrong
   * password), the device provisioning QR (the phone cannot reach the server),
   * and the scheduler's sweep call (no jobs run, so no webhooks are delivered).
   */
  APP_URL: z.string().default('http://localhost:3000'),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  WEBHOOK_SIGNING_SECRET: z
    .string()
    .min(32, 'WEBHOOK_SIGNING_SECRET must be at least 32 characters'),

  MATCH_APPROVE_THRESHOLD: int(100),
  MATCH_AMBIGUITY_MARGIN: int(60),

  INTENT_DEFAULT_TTL_SECONDS: int(300),
  INTENT_MAX_TTL_SECONDS: int(3600),

  HEARTBEAT_GAP_ALERT_MINUTES: int(15),
  CAPTURE_SILENCE_ALERT_HOURS: int(3),
  DEVICE_IP_ALLOWLIST: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  PGBOSS_SCHEMA: z.string().default('jomma_jobs'),
  WEBHOOK_TIMEOUT_MS: int(10_000),

  DEFAULT_LOCALE: z.enum(['en', 'bn']).default('en'),

  FEATURE_MESSAGES_BRIDGE: bool.default(false),
})

export type Env = z.infer<typeof schema>

/**
 * A production deploy must name its own URL.
 *
 * Checked against the raw variable rather than the parsed value, so that
 * *deliberately* pointing a local production build at localhost still works —
 * that is how `next start` is exercised before shipping. What this catches is
 * the deploy that never set it at all and silently inherited the default.
 */
function requireProductionAppUrl(parsed: Env, raw: NodeJS.ProcessEnv): string[] {
  if (parsed.NODE_ENV !== 'production') return []

  const value = raw.APP_URL?.trim()
  if (!value) {
    return [
      "  APP_URL: required in production. Set it to this instance's own public\n" +
        '           URL, e.g. https://pay.yourshop.com. Without it sign-in, device\n' +
        '           provisioning and webhook delivery all fail quietly.',
    ]
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return [`  APP_URL: must be http or https, got ${url.protocol}`]
    }
  } catch {
    return [`  APP_URL: must be an absolute URL, got ${JSON.stringify(value)}`]
  }

  return []
}

let cached: Env | null = null

/**
 * Parses and caches the environment. Throws once, loudly, with every missing key
 * listed — a half-configured payments service should not boot.
 */
export function env(): Env {
  if (cached) return cached
  ensureDotenvLoaded()

  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    throw new Error(
      `Invalid environment:\n${lines.join('\n')}\n\nCopy .env.example to .env and fill it in.`,
    )
  }

  const productionIssues = requireProductionAppUrl(parsed.data, process.env)
  if (productionIssues.length > 0) {
    throw new Error(`Invalid environment:\n${productionIssues.join('\n')}`)
  }

  cached = parsed.data
  return cached
}

/** Test hook. Clears the memoised env so a suite can swap process.env. */
export function resetEnvCache(): void {
  cached = null
  loaded = false
}

export const isProduction = () => env().NODE_ENV === 'production'
export const isTest = () => env().NODE_ENV === 'test'
