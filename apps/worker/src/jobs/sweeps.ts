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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(`${config.APP_URL}/api/internal/sweep`, {
      method: 'POST',
      headers: { 'x-jomma-internal': config.AUTH_SECRET },
      signal: controller.signal,
    })

    if (!response.ok) {
      logger.error({ status: response.status }, 'sweep endpoint rejected the call')
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
    logger.error({ err: error }, 'sweep request failed')
    return null
  } finally {
    clearTimeout(timeout)
  }
}
