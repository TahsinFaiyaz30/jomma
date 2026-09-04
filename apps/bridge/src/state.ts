import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * The bridge's small persistent state.
 *
 * Two things live here: the device token claimed at first boot, and the set of
 * message keys already forwarded. The second is only an optimisation — the
 * server deduplicates on `trx_id` regardless — but without it every restart
 * re-POSTs the entire visible thread, which is a lot of pointless traffic and
 * a lot of noise in the audit log.
 */

export interface BridgeState {
  deviceId: string | null
  deviceToken: string | null
  accountMsisdn: string | null
  /** Keys of messages already forwarded, newest last. Bounded. */
  seen: string[]
}

const EMPTY: BridgeState = { deviceId: null, deviceToken: null, accountMsisdn: null, seen: [] }

/** Enough to cover any realistic backlog without growing without bound. */
const SEEN_LIMIT = 2_000

export async function loadState(file: string): Promise<BridgeState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY }
    const record = parsed as Partial<BridgeState>

    return {
      deviceId: typeof record.deviceId === 'string' ? record.deviceId : null,
      deviceToken: typeof record.deviceToken === 'string' ? record.deviceToken : null,
      accountMsisdn: typeof record.accountMsisdn === 'string' ? record.accountMsisdn : null,
      seen: Array.isArray(record.seen) ? record.seen.filter((k) => typeof k === 'string') : [],
    }
  } catch {
    // No state file yet, or an unreadable one. Either way the bridge starts
    // unprovisioned rather than refusing to boot.
    return { ...EMPTY }
  }
}

export async function saveState(file: string, state: BridgeState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })

  const trimmed: BridgeState = {
    ...state,
    seen: state.seen.slice(-SEEN_LIMIT),
  }

  // Write-then-rename: a crash mid-write must not leave a truncated file that
  // loses the device token and forces a re-provision.
  const temp = `${file}.tmp`
  await writeFile(temp, `${JSON.stringify(trimmed, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, file)
}

export function markSeen(state: BridgeState, key: string): void {
  if (!state.seen.includes(key)) state.seen.push(key)
}
