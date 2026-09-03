import { env } from '@jomma/shared/env'
import { logger } from '../logger'

/**
 * Sweeps that need business logic.
 *
 * Intent expiry emits a webhook and releases a lock; orphan re-matching runs the
 * scorer and can approve a payment. Both are money decisions, so the worker
 * triggers them over HTTP rather than reimplementing them — there is exactly one
 * `applyPayment` in this codebase and it lives in the web app.
 *
 * The trade-off is honest: this sweep needs the web process to be up. In the
 * single-VPS layout both run side by side, and a web app that is down is already
 * an outage.
 */
export async function runSweeps(): Promise<{
  expired: number
  rematched: number
} | null> {
  const config = env()
  const url = `${config.APP_URL}/api/internal/sweep`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-jomma-internal': config.AUTH_SECRET },
      signal: controller.signal,
    })

    if (!response.ok) {
      // Name the URL. A sweep that never runs means intents stop expiring and
      // orphans stop being retried, and the usual cause is APP_URL pointing
      // somewhere the web app is not — which "rejected the call" alone does
      // nothing to tell you.
      logger.error(
        { status: response.status, url },
        'sweep endpoint rejected the call — check APP_URL points at the running web app',
      )
      return null
    }

    const result = (await response.json()) as {
      expired: number
      rematched: number
    }
    if (result.expired > 0 || result.rematched > 0) {
      logger.info(result, 'sweep')
    }
    return result
  } catch (error) {
    logger.error({ err: error, url }, 'sweep request failed')
    return null
  } finally {
    clearTimeout(timeout)
  }
}
