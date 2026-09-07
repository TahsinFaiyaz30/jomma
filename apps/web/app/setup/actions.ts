'use server'

import { revalidatePath } from 'next/cache'
import { requireBusiness, requireWriteAccess } from '@/lib/auth/tenancy'
import { createReceivingAccount, setAccountStatus } from '@/lib/services/account-admin'
import { createApiKey, createApp, createWebhookEndpoint } from '@/lib/services/app-admin'
import {
  assertOwnsApp,
  assertOwnsDevice,
  assertOwnsReceivingAccount,
} from '@/lib/services/businesses'
import {
  approveDevice,
  createDeviceWithProvisioning,
  createPhoneProvisioning,
  revokeDevice,
} from '@/lib/services/devices'
import { getSetupState, markSetupComplete, type SetupState } from '@/lib/services/onboarding'
import { addAccountFromSim, listSimOptions, type SimOption } from '@/lib/services/sim-accounts'
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

/**
 * A code that pairs a phone to this business, with no number attached.
 *
 * The first step now, where adding a number used to be. Nothing about the
 * business's bKash number is known or asked for here — the phone reports what
 * SIMs it can see once it has paired, and the number is chosen from those.
 */
export async function setupPairPhoneAction(): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    const { qrDataUrl, payload } = await createPhoneProvisioning({
      businessId: business.id,
      actorId: admin.id,
    })
    return reply(true, 'Scan this from the Jomma app on that phone.', {
      label: 'Pairing code',
      value: qrDataUrl,
      kind: 'qr',
      expiresAt: payload.expires_at,
    })
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not create the code.')
  }
}

/** The SIMs a paired phone last reported, for the step that chooses one. */
export async function setupListSimsAction(
  deviceId: string,
  provider?: 'bkash' | 'nagad',
): Promise<{ ok: boolean; message: string; sims: SimOption[]; reportedAt: string | null }> {
  const { business } = await requireWriteAccess()

  const found = await listSimOptions({ businessId: business.id, deviceId, provider })
  if (!found)
    return { ok: false, message: 'That phone is not paired here.', sims: [], reportedAt: null }

  return {
    ok: true,
    message:
      found.sims.length === 0
        ? 'The phone has not reported any SIMs yet. Open the app and allow the phone permission.'
        : `${found.sims.length} SIM${found.sims.length === 1 ? '' : 's'} in ${found.deviceName}.`,
    sims: found.sims,
    reportedAt: found.reportedAt?.toISOString() ?? null,
  }
}

/**
 * Turns a chosen SIM into the number this business gets paid on.
 *
 * Replaces typing one in. The phone is told to claim it on its next heartbeat,
 * so nothing else is asked of whoever is holding it.
 */
export async function setupAddAccountFromSimAction(
  deviceId: string,
  subscriptionId: number,
  provider: 'bkash' | 'nagad',
): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    const added = await addAccountFromSim({
      businessId: business.id,
      deviceId,
      subscriptionId,
      provider,
      actorId: admin.id,
    })
    return reply(true, `${added.msisdn} added. The phone will pick it up shortly.`)
  } catch (error) {
    return reply(false, error instanceof Error ? error.message : 'Could not add the number.')
  }
}

/**
 * Approving the phone that has just scanned.
 *
 * Scanning earns nothing on its own — a provisioning QR is a bearer credential
 * that gets screenshotted and forwarded, so the phone lands `awaiting_approval`
 * and captures nothing until somebody says yes. That is deliberate, and it was
 * unreachable from here: the wizard waited for a device it filtered out of its
 * own query, telling people it "checks itself every few seconds" while the
 * phone told them it was waiting for an approval no screen offered.
 *
 * Ownership is checked rather than trusted. This is a server action, so the id
 * arrives from a browser and is a claim; without the check anyone signed in
 * could approve a phone that scanned somebody else's code.
 */
export async function setupApproveDeviceAction(deviceId: string): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    await assertOwnsDevice(business.id, deviceId)
    await approveDevice({ deviceId, actorId: admin.id })
    return reply(true, 'Approved. It will report its SIMs on the next heartbeat.')
  } catch (error) {
    /*
     * A phone that has already stopped waiting is not a failure worth a red
     * toast. The wizard holds its state until an action runs, so one approved
     * in another tab or retired by a fresh scan is still on screen with live
     * buttons; `reply` recomputes the state either way, so the stale entry
     * disappears as the message is shown.
     *
     * Deliberately *not* "Unknown device". That is what `assertOwnsDevice`
     * throws for a phone belonging to somebody else, and forgiving it reports
     * an ownership failure as a success. It also hid a real bug for a release:
     * the guard scoped through a receiving account, so every phone waiting for
     * approval — which by definition has none — looked like another
     * business's, and the operator was told the list had been updated while
     * the row sat there untouched. A wrong green is worse than a blunt red.
     */
    const alreadyHandled = error instanceof Error && /not waiting for approval/i.test(error.message)

    if (alreadyHandled) {
      return reply(true, 'That phone is no longer waiting — the list has been updated.')
    }

    return reply(false, error instanceof Error ? error.message : 'Could not approve it.')
  }
}

/**
 * Turning away a phone that scanned and should not have.
 *
 * The wrong handset, somebody else's, or a code shown on a screen a stranger
 * walked past. Without this the step had one button and no way back: a phone
 * waiting for approval keeps waiting, and scanning again only adds a second
 * one behind it.
 *
 * `revokeDevice` is what does it, the same call the Accounts screen uses — the
 * token hash is cleared, so the credential that phone is holding stops
 * verifying immediately rather than merely being ignored. Once revoked it is no
 * longer `awaiting_approval`, so the step goes back to offering a fresh code.
 */
export async function setupDeclineDeviceAction(deviceId: string): Promise<SetupResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    await assertOwnsDevice(business.id, deviceId)
    await revokeDevice({ deviceId, actorId: admin.id })
    return reply(true, 'Turned away. Show a new code when the right phone is in front of you.')
  } catch (error) {
    /*
     * A phone that has already stopped waiting is not a failure worth a red
     * toast. The wizard holds its state until an action runs, so one approved
     * in another tab or retired by a fresh scan is still on screen with live
     * buttons; `reply` recomputes the state either way, so the stale entry
     * disappears as the message is shown.
     *
     * Deliberately *not* "Unknown device". That is what `assertOwnsDevice`
     * throws for a phone belonging to somebody else, and forgiving it reports
     * an ownership failure as a success. It also hid a real bug for a release:
     * the guard scoped through a receiving account, so every phone waiting for
     * approval — which by definition has none — looked like another
     * business's, and the operator was told the list had been updated while
     * the row sat there untouched. A wrong green is worse than a blunt red.
     */
    const alreadyHandled = error instanceof Error && /not waiting for approval/i.test(error.message)

    if (alreadyHandled) {
      return reply(true, 'That phone is no longer waiting — the list has been updated.')
    }

    return reply(false, error instanceof Error ? error.message : 'Could not decline it.')
  }
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
