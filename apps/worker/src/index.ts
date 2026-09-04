import { env } from '@jomma/shared/env'
import PgBoss from 'pg-boss'
import { triggerJobs } from './jobs/sweeps'
import { logger } from './logger'

/**
 * The worker.
 *
 * A scheduler and nothing else. Every job it triggers is implemented in the web
 * app under `lib/jobs`, and the worker reaches them over the internal endpoint.
 * That split is deliberate: it means a deployment without a persistent
 * background process — a managed host with a cron service — runs *the same
 * code* on the same cadences, rather than a reimplementation that drifts.
 *
 * pg-boss rather than BullMQ: one fewer service to run and monitor, and Postgres
 * already has to be up for anything here to work, so it adds no new failure
 * mode. Job volume is webhook retries, expiry sweeps and alerts — nowhere near
 * where that trade-off flips.
 */

const QUEUES = {
  webhooks: 'jomma.webhooks.deliver',
  sweep: 'jomma.sweep',
  health: 'jomma.health',
  maintenance: 'jomma.maintenance',
} as const

async function main() {
  const config = env()

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: config.PGBOSS_SCHEMA,
    max: 4,
  })

  boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'))

  await boss.start()
  logger.info({ schema: config.PGBOSS_SCHEMA }, 'pg-boss started')

  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue)
  }

  await boss.work(QUEUES.webhooks, { batchSize: 1, pollingIntervalSeconds: 2 }, async () => {
    await triggerJobs('webhooks')
  })

  await boss.work(QUEUES.sweep, { batchSize: 1, pollingIntervalSeconds: 5 }, async () => {
    await triggerJobs('sweep')
  })

  await boss.work(QUEUES.health, { batchSize: 1, pollingIntervalSeconds: 10 }, async () => {
    await triggerJobs('health')
  })

  await boss.work(QUEUES.maintenance, { batchSize: 1, pollingIntervalSeconds: 30 }, async () => {
    await triggerJobs('maintenance')
  })

  /*
   * Schedules. `singletonKey` keeps a slow run from stacking up behind itself —
   * without it a sweep that takes longer than its interval queues a second copy
   * every tick until something falls over.
   */
  await boss.schedule(QUEUES.webhooks, '* * * * *', undefined, { singletonKey: 'webhooks' })
  // Orphan re-matching wants to run every 30 seconds; cron's floor is a minute,
  // so each tick schedules the second run itself.
  await boss.schedule(QUEUES.sweep, '* * * * *', undefined, { singletonKey: 'sweep' })
  await boss.schedule(QUEUES.health, '*/5 * * * *', undefined, { singletonKey: 'health' })
  await boss.schedule(QUEUES.maintenance, '0 * * * *', undefined, { singletonKey: 'maintenance' })

  // Kick everything once on boot rather than waiting up to a minute for the
  // first cron tick — a worker restart should not mean a minute of silence.
  await boss.send(QUEUES.webhooks, {})
  await boss.send(QUEUES.sweep, {})
  await boss.send(QUEUES.health, {})

  // The 30-second half-tick for orphan retries.
  const halfTick = setInterval(() => {
    void boss.send(QUEUES.sweep, {}).catch(() => {})
  }, 30_000)

  logger.info({ appUrl: config.APP_URL }, 'worker ready — webhooks, sweeps, health, maintenance')

  /* ── Shutdown ───────────────────────────────────────────────────────────── */

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down')
    clearInterval(halfTick)
    // Let in-flight handlers finish so a webhook mid-POST is not recorded as a
    // failed attempt it never made.
    await boss.stop({ graceful: true, timeout: 15_000 }).catch(() => {})
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.fatal({ err: error }, 'worker failed to start')
  process.exit(1)
})
