import { randomBytes } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { and, eq } from 'drizzle-orm'
import { generateApiKey, generateDeviceToken } from '../auth/tokens'
import { db, pool } from './client'
import { apiKeys, apps, devices, receivingAccounts, users, webhookEndpoints } from './schema'

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

  /*
   * The admin account. Signup is disabled in the Better Auth config, so this is
   * the only way one comes into existence. Created through the auth API rather
   * than by inserting rows, so the password is hashed exactly the way sign-in
   * expects it to be.
   */
  const adminEmail = process.env.JOMMA_ADMIN_EMAIL ?? 'admin@jomma.local'
  const adminPassword = process.env.JOMMA_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url')

  const existingAdmin = await db.query.users.findFirst({ where: eq(users.email, adminEmail) })
  let adminCreated = false

  if (!existingAdmin) {
    /*
     * A signup-enabled instance, used only here.
     *
     * `createUser` lives in Better Auth's admin plugin and the internal adapter
     * is not public API, so the stable way to mint the first admin is to stand
     * up a second instance with signup on and call the ordinary sign-up
     * endpoint. Same adapter, same tables, same scrypt hashing — so the account
     * it creates is exactly what the real instance expects at sign-in.
     */
    const { seedAuth } = await import('../auth/seed-auth')
    await seedAuth.api.signUpEmail({
      body: { email: adminEmail, password: adminPassword, name: 'Admin' },
    })
    adminCreated = true
  }

  const [app] = await db
    .insert(apps)
    .values({ name: 'Demo Store', slug: 'demo-store' })
    .onConflictDoUpdate({ target: apps.slug, set: { name: 'Demo Store' } })
    .returning()
  if (!app) throw new Error('Failed to upsert app')

  /*
   * Two receiving accounts, each with its own phone.
   *
   * Not a nicety. docs/matching.md is blunt about it: one phone is a single
   * point of failure for the entire revenue stream, and checkout has to be able
   * to route around a `disabled` or drifting account. Seeding one account means
   * the failover path never runs in development and breaks the first time it is
   * needed in production.
   */
  const ACCOUNT_SPECS = [
    {
      provider: 'bkash' as const,
      msisdn: '8801799887766',
      label: 'Jomma Store — bKash',
      device: 'Shop phone',
    },
    {
      provider: 'bkash' as const,
      msisdn: '8801611223344',
      label: 'Jomma Store — bKash 2',
      device: 'Back office phone',
    },
  ]

  const seeded: Array<{
    account: typeof receivingAccounts.$inferSelect
    deviceId: string
    token: string
  }> = []

  for (const spec of ACCOUNT_SPECS) {
    const healthy = {
      label: spec.label,
      status: 'active' as const,
      statusReason: null,
      balanceDrift: false,
      balanceDriftCents: null,
      lastKnownBalanceCents: 4_532_000,
      balanceCheckedAt: new Date(),
      lastHeartbeatAt: new Date(),
    }

    const [account] = await db
      .insert(receivingAccounts)
      .values({
        provider: spec.provider,
        msisdn: spec.msisdn,
        dailyLimitCents: 25_000_000,
        monthlyLimitCents: 300_000_000,
        ...healthy,
      })
      // Re-seeding is the documented way to get a development account back to
      // healthy after the smoke test deliberately trips the drift detector.
      .onConflictDoUpdate({ target: receivingAccounts.msisdn, set: healthy })
      .returning()
    if (!account) throw new Error(`Failed to upsert receiving account ${spec.msisdn}`)

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
          tokenIssuedAt: new Date(),
          provisionedAt: new Date(),
          lastHeartbeatAt: new Date(),
        })
        .where(eq(devices.id, existingDevice.id))
    } else {
      const [created] = await db
        .insert(devices)
        .values({
          receivingAccountId: account.id,
          name: spec.device,
          platform: 'android',
          tokenPrefix: deviceToken.prefix,
          tokenHash: deviceToken.hash,
          status: 'active',
          tokenIssuedAt: new Date(),
          provisionedAt: new Date(),
          appVersion: '1.4.0',
          lastHeartbeatAt: new Date(),
          permissions: { notification_listener: true, sms: true },
        })
        .returning()
      deviceId = created?.id
    }

    if (!deviceId) throw new Error(`Failed to upsert device for ${spec.msisdn}`)
    seeded.push({ account, deviceId, token: deviceToken.plaintext })
  }

  if (seeded.length === 0) throw new Error('No accounts seeded')

  /*
   * Retire the previous seed key before minting a new one.
   *
   * Without this, every `pnpm db:seed` leaves another live credential behind
   * and a development database ends up with a dozen working keys nobody is
   * tracking. Only keys this script created are touched.
   */
  await db
    .update(apiKeys)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(
      and(eq(apiKeys.appId, app.id), eq(apiKeys.name, 'Seed key'), eq(apiKeys.status, 'active')),
    )

  const key = await generateApiKey('live')
  await db.insert(apiKeys).values({
    appId: app.id,
    name: 'Seed key',
    environment: 'live',
    prefix: key.prefix,
    lastFour: key.lastFour,
    keyHash: key.hash,
  })

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
${seeded.map((s) => `  Account             ${s.account.label} — ${s.account.msisdn}`).join('\n')}

  These are shown once. Copy them now.

  Dashboard login     ${adminEmail}
  Dashboard password  ${adminCreated ? adminPassword : '(unchanged — that admin already existed)'}
  API key             ${key.plaintext}
  Webhook secret      ${webhookSecret}

  Devices (one per account, for failover):
${seeded.map((s) => `    ${s.account.msisdn}   token ${s.token}   id ${s.deviceId}`).join('\n')}

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
