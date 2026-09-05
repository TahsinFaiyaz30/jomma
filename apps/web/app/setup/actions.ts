'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { createReceivingAccount, setAccountStatus } from '@/lib/services/account-admin'
import { createApiKey, createApp, createWebhookEndpoint } from '@/lib/services/app-admin'
import { createDeviceWithProvisioning } from '@/lib/services/devices'
import { getSetupState, type SetupState } from '@/lib/services/onboarding'

/**
 * The wizard's actions.
 *
 * Every one calls the same service the ordinary dashboard screen calls, so
 * there is no second path into the database that could validate differently or
 * skip an audit entry. The wizard is a different arrangement of the same
 * buttons, not a parallel implementation.
 *
 * Each returns the recomputed setup state, so the client never has to guess
 * whether a step is now satisfied — the server that just wrote the row says so.
 */

export interface SetupResult {
  ok: boolean
  message: string
  state: SetupState
  /** Shown once and never again: an API key, a webhook secret, a QR. */
  secret?: { label: string; value: string; kind: 'text' | 'qr'; expiresAt?: string }
}

async function reply(
  ok: boolean,
  message: string,
  secret?: SetupResult['secret'],
): Promise<SetupResult> {
  revalidatePath('/setup')
  revalidatePath('/accounts')
  revalidatePath('/apps')
  revalidatePath('/')
  return { ok, message, state: await getSetupState(), secret }
}

export async function refreshSetupAction(): Promise<SetupResult> {
  await requireAdmin()
  return reply(true, '')
}

export async function setupAddAccountAction(
  provider: 'bkash' | 'nagad',
  msisdn: string,
  label: string,
): Promise<SetupResult> {
  const admin = await requireAdmin()
  if (!label.trim()) return reply(false, 'Give the account a label.')

  try {
    const account = await createReceivingAccount({ provider, msisdn, label, actorId: admin.id })
    return reply(true, `${account.msisdn} added.`)
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not add the account.')
  }
}

export async function setupAddDeviceAction(
  receivingAccountId: string,
  name: string,
): Promise<SetupResult> {
  const admin = await requireAdmin()
  if (!name.trim()) return reply(false, 'Give the phone a name.')

  try {
    const { qrDataUrl, payload } = await createDeviceWithProvisioning({
      receivingAccountId,
      name: name.trim(),
      actorId: admin.id,
    })
    return reply(true, 'Scan this from the Jomma app on that phone.', {
      label: 'Provisioning QR',
      value: qrDataUrl,
      kind: 'qr',
      expiresAt: payload.expires_at,
    })
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not create the device.')
  }
}

export async function setupEnableAccountAction(accountId: string): Promise<SetupResult> {
  const admin = await requireAdmin()
  try {
    await setAccountStatus({ accountId, status: 'active', actorId: admin.id })
    return reply(true, 'Account enabled. Checkout can route to it now.')
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not enable it.')
  }
}

export async function setupCreateAppAction(name: string): Promise<SetupResult> {
  const admin = await requireAdmin()
  if (!name.trim()) return reply(false, 'Give the business a name.')

  try {
    const app = await createApp({ name, actorId: admin.id })
    return reply(true, `Created as "${app.slug}".`)
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not create it.')
  }
}

export async function setupCreateKeyAction(appId: string): Promise<SetupResult> {
  const admin = await requireAdmin()
  try {
    const { plaintext } = await createApiKey({
      appId,
      name: 'Live key',
      environment: 'live',
      actorId: admin.id,
    })
    return reply(true, 'Copy it now — it is hashed at rest and cannot be shown again.', {
      label: 'API key',
      value: plaintext,
      kind: 'text',
    })
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not create the key.')
  }
}

export async function setupAddEndpointAction(appId: string, url: string): Promise<SetupResult> {
  await requireAdmin()

  const trimmed = url.trim()
  if (!/^https?:\/\//.test(trimmed)) {
    return reply(false, 'The URL must start with http:// or https://.')
  }

  try {
    const { secret } = await createWebhookEndpoint({ appId, url: trimmed })
    return reply(true, 'Endpoint saved. Verify signatures with this secret.', {
      label: 'Signing secret',
      value: secret,
      kind: 'text',
    })
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not save the endpoint.')
  }
}
