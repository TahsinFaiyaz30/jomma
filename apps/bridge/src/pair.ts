import { loadConfig } from './config'
import { logger } from './logger'
import { MessagesSession } from './session'

/**
 * `pnpm --filter @jomma/bridge pair`
 *
 * Opens a real browser window at messages.google.com and waits while a human
 * scans the QR with the phone. The pairing is written into the Chromium profile
 * directory, which the long-running bridge then reuses.
 *
 * This is a separate entry point on purpose. The bridge itself never opens a
 * visible window and never waits for a person — if it needs pairing, it alerts
 * and somebody runs this.
 */
async function main() {
  const config = loadConfig()
  const session = new MessagesSession({ ...config, headed: true })

  await session.open()

  logger.info(
    { profile: config.profileDir },
    'Scan the QR with Messages on the phone, tick "remember this computer", then press Ctrl+C.',
  )

  const health = setInterval(() => {
    void session.health().then((result) => {
      if (result.ok) {
        logger.info('paired — the profile is saved. Ctrl+C to close, then start the bridge.')
        clearInterval(health)
      }
    })
  }, 5_000)

  process.on('SIGINT', () => {
    clearInterval(health)
    void session.close().then(() => process.exit(0))
  })
}

main().catch((error) => {
  logger.fatal({ err: error }, 'pairing helper failed')
  process.exit(1)
})
