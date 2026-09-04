#!/usr/bin/env node
/**
 * Trigger the scheduled jobs once, then exit.
 *
 * This is what a cron entry runs on a host with no persistent worker. It is
 * deliberately trivial — all the work lives in the web app under lib/jobs, and
 * this only asks for it. A cron service that can issue an authenticated GET can
 * skip this file entirely and call the URL directly.
 *
 * Usage: node scripts/run-jobs.mjs [group]
 *   group: sweep | webhooks | health | maintenance | all   (default: all)
 */

const group = process.argv[2] ?? 'all'
const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const secret = process.env.AUTH_SECRET

if (!secret) {
  console.error('AUTH_SECRET is not set. It is the credential for /api/internal/sweep.')
  process.exit(1)
}

const url = `${base}/api/internal/sweep?group=${encodeURIComponent(group)}`

// Generous: a webhook batch against a slow endpoint is the long pole, and a
// timeout here would be reported as a failed cron run when the work is fine.
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 90_000)

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-jomma-internal': secret },
    signal: controller.signal,
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    // Name the URL. The usual cause of a rejected call is APP_URL pointing
    // somewhere the web app is not, and the status alone does not say that.
    console.error(`sweep rejected with ${response.status} — ${url}`)
    console.error(JSON.stringify(body))
    process.exit(1)
  }

  console.log(JSON.stringify({ group, ...body }))
} catch (error) {
  console.error(`sweep request failed — ${url}`)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  clearTimeout(timeout)
}
