'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import {
  createApiKey,
  createWebhookEndpoint,
  replayAllFailed,
  replayDelivery,
  revokeApiKey,
  setEndpointStatus,
} from '@/lib/services/app-admin'

export interface AppActionResult {
  ok: boolean
  message: string
  /** Shown once. Never retrievable again. */
  secret?: { label: string; value: string }
}

export async function createKeyAction(
  appId: string,
  name: string,
  environment: 'live' | 'test',
): Promise<AppActionResult> {
  const admin = await requireAdmin()
  if (!name.trim()) return { ok: false, message: 'Give the key a name.' }

  try {
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
  const admin = await requireAdmin()
  try {
    await revokeApiKey({ keyId, actorId: admin.id })
    revalidatePath('/apps')
    return { ok: true, message: 'Revoked. Requests using it now get 401.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not revoke.' }
  }
}

export async function createEndpointAction(appId: string, url: string): Promise<AppActionResult> {
  await requireAdmin()

  const trimmed = url.trim()
  if (!/^https?:\/\//.test(trimmed)) {
    return { ok: false, message: 'The URL must start with http:// or https://.' }
  }

  try {
    const { secret } = await createWebhookEndpoint({ appId, url: trimmed })
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
  await requireAdmin()
  try {
    await setEndpointStatus({ endpointId, status })
    revalidatePath('/apps')
    return { ok: true, message: status === 'active' ? 'Endpoint enabled.' : 'Endpoint disabled.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not update.' }
  }
}

export async function replayDeliveryAction(deliveryId: string): Promise<AppActionResult> {
  const admin = await requireAdmin()
  try {
    await replayDelivery({ deliveryId, actorId: admin.id })
    revalidatePath('/apps')
    return { ok: true, message: 'Queued for redelivery on the next worker poll.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not replay.' }
  }
}

export async function replayAllFailedAction(appId: string): Promise<AppActionResult> {
  const admin = await requireAdmin()
  try {
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
