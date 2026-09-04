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

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),
  DATABASE_POOL_MAX: int(10),

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
