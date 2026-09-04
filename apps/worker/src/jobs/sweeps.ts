import { env } from '@jomma/shared/env'
import { logger } from '../logger'

/**
 * Triggering scheduled work.
 *
 * The worker owns *scheduling*; the web app owns every decision that touches
 * money and every query that touches the tables. Expiry emits a webhook and
 * releases a lock, orphan re-matching runs the scorer and can approve a payment
 * — so the worker asks over HTTP rather than reimplementing any of it. There is
 * exactly one `applyPayment` in this codebase.
 *
 * Keeping the worker this thin is also what makes it optional: a host with no
 * persistent background process points a cron service at the same URL and gets
 * the same behaviour, because there is only one implementation to get.
 *
 * The trade-off is honest: this needs the web process to be up. A web app that
 * is down is already an outage.
 */

export type JobGroup = 'sweep' | 'webhooks' | 'health' | 'maintenance' | 'all'

export async function triggerJobs(group: JobGroup): Promise<Record<string, number> | null> {
  const config = env()
  const url = `${config.APP_URL}/api/internal/sweep?group=${group}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-jomma-internal': config.AUTH_SECRET },
      signal: controller.signal,
    })

    if (!response.ok) {
      /*
       * Name the URL. Jobs that never run mean intents stop expiring, orphans
       * stop being retried and webhooks stop being delivered — and the usual
       * cause is APP_URL pointing somewhere the web app is not, which "rejected
       * the call" alone does nothing to tell you.
       */
      logger.error(
        { status: response.status, url, group },
        'sweep endpoint rejected the call — check APP_URL points at the running web app',
      )
      return null
    }

    const result = (await response.json()) as Record<string, number>

    const worthLogging = Object.entries(result).some(
      ([key, value]) => key !== 'ms' && typeof value === 'number' && value > 0,
    )
    if (worthLogging) logger.info({ group, ...result }, 'jobs ran')

    return result
  } catch (error) {
    logger.error({ err: error, url, group }, 'sweep request failed')
    return null
  } finally {
    clearTimeout(timeout)
  }
}
