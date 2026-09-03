import { randomBytes } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { eq } from 'drizzle-orm'
import { generateApiKey, generateDeviceToken } from '../auth/tokens'
import { db, pool } from './client'
import { apiKeys, apps, devices, receivingAccounts, webhookEndpoints } from './schema'

/**
 * Development seed. One app, one API key, one receiving account, one device.
 *
 * Idempotent: re-running finds the existing app and receiving account by slug
 * and msisdn and only mints new credentials, so `pnpm db:seed` twice does not
 * produce two of everything.
 */

async function main() {
  if (env().NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.')
  }

  const [app] = await db
    .insert(apps)
    .values({ name: 'Demo Store', slug: 'demo-store' })
    .onConflictDoUpdate({ target: apps.slug, set: { name: 'Demo Store' } })
    .returning()
  if (!app) throw new Error('Failed to upsert app')

  const [account] = await db
    .insert(receivingAccounts)
    .values({
      provider: 'bkash',
      msisdn: '8801799887766',
      label: 'Jomma Store — bKash',
      status: 'active',
      dailyLimitCents: 25_000_000,
      monthlyLimitCents: 300_000_000,
      lastKnownBalanceCents: 4_532_000,
      balanceCheckedAt: new Date(),
      lastHeartbeatAt: new Date(),
    })
    .onConflictDoUpdate({
      target: receivingAccounts.msisdn,
      // Re-seeding is the documented way to get a development account back to
      // healthy after the smoke test deliberately trips the drift detector.
      set: {
        label: 'Jomma Store — bKash',
        status: 'active',
        statusReason: null,
        balanceDrift: false,
        balanceDriftCents: null,
        lastKnownBalanceCents: 4_532_000,
        balanceCheckedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    })
    .returning()
  if (!account) throw new Error('Failed to upsert receiving account')

  const key = await generateApiKey('live')
  await db.insert(apiKeys).values({
    appId: app.id,
    name: 'Seed key',
    environment: 'live',
    prefix: key.prefix,
    lastFour: key.lastFour,
    keyHash: key.hash,
  })

  const deviceToken = await generateDeviceToken()
  const existingDevice = await db.query.devices.findFirst({
    where: eq(devices.receivingAccountId, account.id),
  })

  let deviceId = existingDevice?.id
  if (existingDevice) {
    await db
      .update(devices)
      .set({
        tokenPrefix: deviceToken.prefix,
        tokenHash: deviceToken.hash,
        status: 'active',
      })
      .where(eq(devices.id, existingDevice.id))
  } else {
    const [created] = await db
      .insert(devices)
      .values({
        receivingAccountId: account.id,
        name: 'Shop phone',
        platform: 'android',
        tokenPrefix: deviceToken.prefix,
        tokenHash: deviceToken.hash,
        appVersion: '1.4.0',
        lastHeartbeatAt: new Date(),
        permissions: { notification_listener: true, sms: true },
      })
      .returning()
    deviceId = created?.id
  }

  const webhookSecret = `whsec_${randomBytes(24).toString('hex')}`
  await db
    .insert(webhookEndpoints)
    .values({
      appId: app.id,
      url: 'http://localhost:4000/webhooks/jomma',
      description: 'Local development receiver',
      secret: webhookSecret,
      enabledEvents: [
        'payment.succeeded',
        'payment.partial',
        'payment.overpaid',
        'payment.expired',
        'payment.cancelled',
        'payment.reversed',
        'account.degraded',
        'account.recovered',
      ],
    })
    .onConflictDoUpdate({
      target: [webhookEndpoints.appId, webhookEndpoints.url],
      set: { secret: webhookSecret, status: 'active' },
    })

  console.log(`
Seed complete.

  App                 ${app.name} (${app.slug})
  Receiving account   ${account.label} — ${account.msisdn}
  Device              Shop phone (${deviceId})

  These are shown once. Copy them now.

  API key             ${key.plaintext}
  Device token        ${deviceToken.plaintext}
  Device id           ${deviceId}
  Webhook secret      ${webhookSecret}

  Try it:

    curl -X POST http://localhost:3000/v1/intents \\
      -H "Authorization: Bearer ${key.plaintext}" \\
      -H "Idempotency-Key: $(date +%s)" \\
      -H "Content-Type: application/json" \\
      -d '{"amount":120000,"client_reference":"ORD-2026-001043","ttl_seconds":300}'
`)

  await pool.end()
}

main().catch(async (error) => {
  console.error('Seed failed:', error)
  await pool.end().catch(() => {})
  process.exit(1)
})
