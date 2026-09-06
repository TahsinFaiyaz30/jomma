'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/auth/tenancy'
import {
  createApiKey,
  createApp,
  createWebhookEndpoint,
  replayAllFailed,
  replayDelivery,
  revokeApiKey,
  setAllowedRedirectHosts,
  setEndpointStatus,
} from '@/lib/services/app-admin'
import {
  assertOwnsApiKey,
  assertOwnsApp,
  assertOwnsDelivery,
  assertOwnsEndpoint,
} from '@/lib/services/businesses'
import { assertDeliverableUrl, WebhookTargetError } from '@/lib/services/webhook-targets'

export interface AppActionResult {
  ok: boolean
  message: string
  /** Shown once. Never retrievable again. */
  secret?: { label: string; value: string }
}

export async function createAppAction(name: string): Promise<AppActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  if (!name.trim()) return { ok: false, message: 'Give the app a name.' }

  try {
    const app = await createApp({ businessId: business.id, name, actorId: admin.id })
    revalidatePath('/apps')
    return {
      ok: true,
      message: `Created as "${app.slug}". Add an API key and a webhook endpoint next.`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not create app.' }
  }
}

export async function createKeyAction(
  appId: string,
  name: string,
  environment: 'live' | 'test',
): Promise<AppActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  if (!name.trim()) return { ok: false, message: 'Give the key a name.' }

  try {
    await assertOwnsApp(business.id, appId)
    const { plaintext } = await createApiKey({
      appId,
      name: name.trim(),
      environment,
      actorId: admin.id,
    })
    revalidatePath('/apps')
    return {
      ok: true,
      message: 'Copy it now — it is not stored and cannot be shown again.',
      secret: { label: 'API key', value: plaintext },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not create key.' }
  }
}

export async function revokeKeyAction(keyId: string): Promise<AppActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  try {
    await assertOwnsApiKey(business.id, keyId)
    await revokeApiKey({ keyId, actorId: admin.id })
    revalidatePath('/apps')
    return { ok: true, message: 'Revoked. Requests using it now get 401.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not revoke.' }
  }
}

export async function createEndpointAction(appId: string, url: string): Promise<AppActionResult> {
  const { business } = await requireWriteAccess()
  await assertOwnsApp(business.id, appId)

  let target: URL
  try {
    // Protocol *and* destination. On a shared instance this is what stops an
    // endpoint being pointed at the private network — see assertDeliverableUrl.
    target = await assertDeliverableUrl(url)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof WebhookTargetError ? error.message : 'That URL cannot be used.',
    }
  }

  try {
    const { secret } = await createWebhookEndpoint({ appId, url: target.toString() })
    revalidatePath('/apps')
    return {
      ok: true,
      message: 'Endpoint saved. Use this secret to verify signatures.',
      secret: { label: 'Signing secret', value: secret },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save.' }
  }
}

export async function toggleEndpointAction(
  endpointId: string,
  status: 'active' | 'disabled',
): Promise<AppActionResult> {
  const { business } = await requireWriteAccess()
  try {
    await assertOwnsEndpoint(business.id, endpointId)
    await setEndpointStatus({ endpointId, status })
    revalidatePath('/apps')
    return { ok: true, message: status === 'active' ? 'Endpoint enabled.' : 'Endpoint disabled.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not update.' }
  }
}

export async function replayDeliveryAction(deliveryId: string): Promise<AppActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  try {
    await assertOwnsDelivery(business.id, deliveryId)
    await replayDelivery({ deliveryId, actorId: admin.id })
    revalidatePath('/apps')
    return { ok: true, message: 'Queued for redelivery on the next worker poll.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not replay.' }
  }
}

export async function replayAllFailedAction(appId: string): Promise<AppActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  try {
    await assertOwnsApp(business.id, appId)
    const count = await replayAllFailed({ appId, actorId: admin.id })
    revalidatePath('/apps')
    return {
      ok: true,
      message: count === 0 ? 'Nothing failed to replay.' : `Queued ${count} for redelivery.`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not replay.' }
  }
}

/**
 * Register the hostnames the hosted pay page may return a buyer to.
 *
 * Empty is a valid answer and means the app does not use hosted redirect at
 * all — the pay page still works, it just has nowhere to send them afterwards.
 */
export async function setRedirectHostsAction(appId: string, raw: string): Promise<AppActionResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    await assertOwnsApp(business.id, appId)
    const hosts = await setAllowedRedirectHosts({
      appId,
      hosts: raw.split(/[\s,]+/),
      actorId: admin.id,
    })

    revalidatePath('/apps')

    return {
      ok: true,
      message:
        hosts.length === 0
          ? 'Cleared. This app cannot redirect buyers anywhere.'
          : `Buyers can be returned to ${hosts.join(', ')}.`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save.' }
  }
}
