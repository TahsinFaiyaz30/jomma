import { JommaClient } from './client'
import { type BridgeConfig, loadConfig } from './config'
import { logger } from './logger'
import { listConversations, readConversation, type ScrapedMessage } from './scrape'
import { MessagesSession, type SessionHealth } from './session'
import { type BridgeState, loadState, markSeen, saveState } from './state'

/**
 * The Messages bridge.
 *
 * Optional, opt-in, best-effort. It relays through the phone, so it does **not**
 * protect against the phone being off — the thing that actually goes wrong. It
 * exists to catch the narrower case where the Android app has been killed or
 * has lost a permission while the phone itself is fine and online.
 *
 * The load-bearing behaviour is not the scraping. It is this: the bridge
 * heartbeats *only while its session is healthy*. A pairing that expired, a DOM
 * that changed, a browser that crashed — all of them stop the heartbeat, and
 * the same worker job that notices a dead phone notices a dead bridge. There is
 * no state in which this process looks fine while silently returning nothing.
 */

const APP_VERSION = '0.1.0'

/**
 * The credentials the loop needs, guaranteed present.
 *
 * Returned as its own type rather than read back off `BridgeState` so the two
 * values are non-nullable by construction — the alternative is a nullable field
 * that every call site has to re-assert, which is how a bridge ends up POSTing
 * `null` as a phone number.
 */
interface Provisioned {
  state: BridgeState
  deviceToken: string
  accountMsisdn: string
}

async function ensureProvisioned(
  config: BridgeConfig,
  client: JommaClient,
  state: BridgeState,
): Promise<Provisioned> {
  if (state.deviceToken && state.accountMsisdn) {
    return { state, deviceToken: state.deviceToken, accountMsisdn: state.accountMsisdn }
  }

  if (!config.deviceId || !config.provisioningToken) {
    throw new Error(
      'The bridge is not provisioned. Create a device on the Accounts page with platform ' +
        '"bridge", then start this process once with BRIDGE_DEVICE_ID and ' +
        'BRIDGE_PROVISIONING_TOKEN set. See apps/bridge/README.md.',
    )
  }

  const result = await client.provision(config.deviceId, config.provisioningToken)
  if (!result.accountMsisdn) {
    throw new Error('Provisioning did not return a receiving number; cannot address captures.')
  }

  const next: BridgeState = {
    ...state,
    deviceId: result.deviceId,
    deviceToken: result.deviceToken,
    accountMsisdn: result.accountMsisdn,
  }

  await saveState(config.stateFile, next)
  logger.info(
    { deviceId: result.deviceId },
    'bridge provisioned — remove BRIDGE_PROVISIONING_TOKEN',
  )

  return { state: next, deviceToken: result.deviceToken, accountMsisdn: result.accountMsisdn }
}

async function main() {
  const config = loadConfig()
  const client = new JommaClient(config)

  const { state, deviceToken, accountMsisdn } = await ensureProvisioned(
    config,
    client,
    await loadState(config.stateFile),
  )

  const session = new MessagesSession(config)
  await session.open()
  await client.reportEvent(deviceToken, 'boot', 'Messages bridge started', {
    app_version: APP_VERSION,
  })

  /*
   * Only alert on the *transition* into a fault. Without this a bridge that has
   * been signed out for a week writes a critical alert every twenty seconds and
   * buries everything else on the page.
   */
  let lastFaultReported: string | null = null
  let lastHealth: SessionHealth = { ok: false, fault: null, detail: 'Starting up.' }
  let pending = 0
  let stopping = false

  /** Alert once per distinct fault, and try the one recovery that can work. */
  async function handleFault(health: SessionHealth): Promise<void> {
    const signature = `${health.fault}:${health.detail}`
    if (signature !== lastFaultReported) {
      lastFaultReported = signature
      logger.error({ fault: health.fault, detail: health.detail }, 'bridge session is not usable')
      // Explicit alert *and* the heartbeat stops in beat(). Belt and braces,
      // because the explicit one is the only thing that can say why.
      await client.reportEvent(deviceToken, 'bridge_session_lost', health.detail, {
        fault: health.fault,
      })
    }

    // A reload fixes a crashed tab; it does not fix an expired pairing, and it
    // is not supposed to. Somebody has to re-scan.
    if (health.fault === 'unreachable') await session.reload()
  }

  /** Returns how many messages are still waiting to be forwarded. */
  async function forwardNew(messages: ScrapedMessage[]): Promise<number> {
    const fresh = messages.filter((message) => !state.seen.includes(message.key))
    let waiting = fresh.length

    for (const message of fresh) {
      try {
        const result = await client.forward({ msisdn: accountMsisdn, raw: message.text })

        markSeen(state, message.key)
        waiting -= 1

        logger.info(
          { status: result.status, trxId: result.trxId, matched: result.matched },
          'forwarded a message',
        )
      } catch (error) {
        // Left unmarked, so the next poll retries it. The server's trx_id
        // dedupe means a retry that actually landed the first time is free.
        logger.warn({ err: error }, 'could not forward a message; will retry')
      }
    }

    return waiting
  }

  async function poll(): Promise<void> {
    const health = await session.health()
    lastHealth = health

    if (!health.ok) {
      await handleFault(health)
      return
    }

    if (lastFaultReported) {
      logger.info('bridge session recovered')
      lastFaultReported = null
    }

    const page = session.page_()
    if (!page) return

    const conversations = await listConversations(page)
    const watched = conversations.filter((c) => config.senderPattern.test(c.name))

    let waiting = 0
    for (const conversation of watched) {
      const messages = await readConversation(page, conversation.index, conversation.name)
      waiting += await forwardNew(messages)
    }

    pending = waiting
    await saveState(config.stateFile, state)
  }

  async function beat(): Promise<void> {
    // The whole design in one branch: no heartbeat while unhealthy, so the
    // server's gap detector treats a broken bridge exactly like a dead one.
    if (!lastHealth.ok) {
      logger.debug({ fault: lastHealth.fault }, 'withholding heartbeat — session is not healthy')
      return
    }

    try {
      await client.heartbeat(deviceToken, {
        queueDepth: pending,
        appVersion: APP_VERSION,
        sessionOk: true,
      })
    } catch (error) {
      logger.warn({ err: error }, 'heartbeat failed')
    }
  }

  await poll()
  await beat()

  const pollTimer = setInterval(() => {
    if (stopping) return
    void poll().catch((error) => logger.error({ err: error }, 'poll failed'))
  }, config.pollSeconds * 1_000)

  const beatTimer = setInterval(() => {
    if (stopping) return
    void beat()
  }, config.heartbeatSeconds * 1_000)

  logger.info(
    { poll: config.pollSeconds, heartbeat: config.heartbeatSeconds },
    'bridge ready — best-effort, and not redundancy for a phone being off',
  )

  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'shutting down')
    clearInterval(pollTimer)
    clearInterval(beatTimer)
    await saveState(config.stateFile, state).catch(() => {})
    await session.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.fatal({ err: error }, 'bridge failed to start')
  process.exit(1)
})
