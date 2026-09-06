'use server'

import { revalidatePath } from 'next/cache'
import { requireBusiness, requireWriteAccess } from '@/lib/auth/tenancy'
import { createReceivingAccount, setAccountStatus } from '@/lib/services/account-admin'
import { createApiKey, createApp, createWebhookEndpoint } from '@/lib/services/app-admin'
import { assertOwnsApp, assertOwnsReceivingAccount } from '@/lib/services/businesses'
import { createDeviceWithProvisioning } from '@/lib/services/devices'
import { getSetupState, markSetupComplete, type SetupState } from '@/lib/services/onboarding'
import { assertDeliverableUrl, WebhookTargetError } from '@/lib/services/webhook-targets'

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
 *
 * Every action that takes a row id checks that the row belongs to the caller's
 * business. Four of them once did not, and being "the wizard" is no protection:
 * these are ordinary POST endpoints that anybody with a session can call
 * directly, whether or not the screen that normally calls them is on display.
 * `setupCreateKeyAction` in particular returned a live API key for whatever app
 * id it was handed.
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

  const { business } = await requireBusiness()
  const state = await getSetupState(business.id)
  // The moment the last required step lands, record it — so a later disable or
  // revoke shows a banner rather than throwing the operator back in here.
  if (state.complete) await markSetupComplete()

  return { ok, message, state, secret }
}

export async function refreshSetupAction(): Promise<SetupResult> {
  // Read-only, and `reply` scopes the state it returns to the caller's business.
  await requireBusiness()
  return reply(true, '')
}

export async function setupAddAccountAction(
  provider: 'bkash' | 'nagad',
  msisdn: string,
  label: string,
): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()
  if (!label.trim()) return reply(false, 'Give the account a label.')

  try {
    const account = await createReceivingAccount({
      businessId: business.id,
      provider,
      msisdn,
      label,
      actorId: admin.id,
    })
    return reply(true, `${account.msisdn} added.`)
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not add the account.')
  }
}

export async function setupAddDeviceAction(
  receivingAccountId: string,
  name?: string,
): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    await assertOwnsReceivingAccount(business.id, receivingAccountId)
    const { qrDataUrl, payload } = await createDeviceWithProvisioning({
      receivingAccountId,
      name: name?.trim() || null,
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
  const { user: admin, business } = await requireWriteAccess()
  try {
    await assertOwnsReceivingAccount(business.id, accountId)
    await setAccountStatus({ accountId, status: 'active', actorId: admin.id })
    return reply(true, 'Account enabled. Checkout can route to it now.')
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not enable it.')
  }
}

export async function setupCreateAppAction(name: string): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()
  if (!name.trim()) return reply(false, 'Give the app a name.')

  try {
    const app = await createApp({ businessId: business.id, name, actorId: admin.id })
    return reply(true, `Created as "${app.slug}".`)
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not create it.')
  }
}

export async function setupCreateKeyAction(appId: string): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()
  try {
    // The worst of the four. Without this, any signed-in user could mint a live
    // key for any app on the instance and read the plaintext straight out of
    // the response -- a complete takeover of another merchant's integration.
    await assertOwnsApp(business.id, appId)
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
  const { business } = await requireWriteAccess()

  let target: URL
  try {
    // Protocol *and* destination. The wizard is a different arrangement of the
    // same buttons, so it has to refuse the same addresses the apps screen does
    // -- otherwise the check is just a longer route to the same endpoint row.
    target = await assertDeliverableUrl(url)
  } catch (error) {
    return reply(
      false,
      error instanceof WebhookTargetError ? error.message : 'That URL cannot be used.',
    )
  }

  try {
    // Without this, anyone signed in could point another merchant's webhooks at
    // a URL they control and be handed the signing secret -- every payment event
    // that merchant receives, delivered to the attacker and verifiable.
    await assertOwnsApp(business.id, appId)
    const { secret } = await createWebhookEndpoint({ appId, url: target.toString() })
    return reply(true, 'Endpoint saved. Verify signatures with this secret.', {
      label: 'Signing secret',
      value: secret,
      kind: 'text',
    })
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not save the endpoint.')
  }
}
