import { resolve } from 'node:path'
import { env } from '@jomma/shared/env'

/**
 * Bridge configuration.
 *
 * Shares the repo's env loader so `WEBHOOK_SIGNING_SECRET` and `APP_URL` are
 * the same values the server uses, with a handful of bridge-only knobs on top.
 */

export interface BridgeConfig {
  /** Where Jomma lives. The bridge talks to the public paths, not `/api/*`. */
  baseUrl: string
  signingSecret: string

  /** Chromium profile directory. The Messages pairing lives here. */
  profileDir: string
  /** Where the claimed device token and the seen-message ledger are kept. */
  stateFile: string

  /** Poll interval for new messages. */
  pollSeconds: number
  /** Heartbeat interval — matches the Android app's five minutes. */
  heartbeatSeconds: number

  /** Show the browser window. Required for the initial pairing scan. */
  headed: boolean

  /**
   * One-time provisioning value from the dashboard, used on first boot only.
   * After that the device token in the state file is the credential.
   */
  provisioningToken: string | null
  deviceId: string | null

  /** Only conversations whose sender matches are read. */
  senderPattern: RegExp
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return parsed
}

export function loadConfig(): BridgeConfig {
  const shared = env()

  /*
   * The flag is checked here rather than at the call site so there is exactly
   * one place that decides whether this process is allowed to exist. AGENTS.md
   * requires the bridge to be opt-in; a scraper that starts because someone
   * ran the wrong pnpm script is not opt-in.
   */
  if (!shared.FEATURE_MESSAGES_BRIDGE) {
    throw new Error(
      'FEATURE_MESSAGES_BRIDGE is not enabled. The Messages bridge is opt-in and best-effort; ' +
        'set it in .env deliberately, and read apps/bridge/README.md first.',
    )
  }

  const stateDir = process.env.BRIDGE_STATE_DIR ?? resolve(process.cwd(), '.bridge')

  return {
    baseUrl: (process.env.BRIDGE_BASE_URL ?? shared.APP_URL).replace(/\/+$/, ''),
    signingSecret: shared.WEBHOOK_SIGNING_SECRET,
    profileDir: resolve(stateDir, 'chromium-profile'),
    stateFile: resolve(stateDir, 'state.json'),
    pollSeconds: num('BRIDGE_POLL_SECONDS', 20),
    heartbeatSeconds: num('BRIDGE_HEARTBEAT_SECONDS', 300),
    headed: process.env.BRIDGE_HEADED === 'true',
    provisioningToken: process.env.BRIDGE_PROVISIONING_TOKEN?.trim() || null,
    deviceId: process.env.BRIDGE_DEVICE_ID?.trim() || null,
    // bKash and Nagad both send from a shortcode or an alphanumeric sender ID.
    // Anything else in the inbox is somebody's actual conversation and is never
    // read — the bridge has no business touching it.
    senderPattern: new RegExp(process.env.BRIDGE_SENDER_PATTERN ?? '^(bkash|nagad)$', 'i'),
  }
}
