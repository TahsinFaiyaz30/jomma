'use server'

import type { CaptureSettings } from '@jomma/shared'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import {
  acknowledgeAlert,
  createReceivingAccount,
  setAccountStatus,
  setCaptureSettings,
} from '@/lib/services/account-admin'
import {
  createDeviceWithProvisioning,
  requestTokenRotation,
  revokeDevice,
} from '@/lib/services/devices'

export interface DeviceActionResult {
  ok: boolean
  message: string
  /** Shown once and never again — the QR image, or a rotated token. */
  secret?: { kind: 'qr'; dataUrl: string; expiresAt: string } | { kind: 'token'; value: string }
}

export async function addAccountAction(
  provider: 'bkash' | 'nagad',
  msisdn: string,
  label: string,
): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  if (!label.trim()) return { ok: false, message: 'Give the account a label.' }

  try {
    const account = await createReceivingAccount({
      provider,
      msisdn,
      label,
      actorId: admin.id,
    })
    revalidatePath('/accounts')
    revalidatePath('/')
    return {
      ok: true,
      message: `${account.msisdn} added, and disabled until a phone is watching it. Add a device below, then enable it.`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not add account.' }
  }
}

export async function addDeviceAction(
  receivingAccountId: string,
  name: string,
): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  if (!name.trim()) return { ok: false, message: 'Give the device a name.' }

  try {
    const { qrDataUrl, payload } = await createDeviceWithProvisioning({
      receivingAccountId,
      name: name.trim(),
      actorId: admin.id,
    })
    revalidatePath('/accounts')
    return {
      ok: true,
      message: 'Scan this with the phone — any QR scanner works. It expires in 15 minutes.',
      secret: { kind: 'qr', dataUrl: qrDataUrl, expiresAt: payload.expires_at },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not add device.' }
  }
}

export async function rotateTokenAction(deviceId: string): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  try {
    await requestTokenRotation({ deviceId, actorId: admin.id })
    revalidatePath('/accounts')
    return {
      ok: true,
      /*
       * No secret to show. The device collects its new token itself on the next
       * heartbeat, using the one it still holds — which is the only way to hand
       * it over without either storing a plaintext token or cutting the phone
       * off the instant someone clicked a button.
       *
       * If the point is that a token leaked, revoke instead. That is immediate.
       */
      message: 'Queued. The device swaps its token on the next heartbeat.',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not rotate.' }
  }
}

export async function revokeDeviceAction(deviceId: string): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  try {
    await revokeDevice({ deviceId, actorId: admin.id })
    revalidatePath('/accounts')
    return { ok: true, message: 'Revoked. That device must be re-provisioned by QR.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not revoke.' }
  }
}

export async function setAccountStatusAction(
  accountId: string,
  status: 'active' | 'disabled',
): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  try {
    await setAccountStatus({ accountId, status, actorId: admin.id })
    revalidatePath('/accounts')
    revalidatePath('/')
    return {
      ok: true,
      message:
        status === 'disabled'
          ? 'Account disabled — checkout will route around it.'
          : 'Account re-enabled.',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not update.' }
  }
}

/**
 * Which message types this number keeps.
 *
 * The identical switches exist in the notifier app, writing to this same row
 * over `/device/v1/settings`. Neither side owns the value: whichever wrote last
 * wins, and the other picks the change up on its next heartbeat. That is enough
 * because nothing here is destructive — the worst a stale phone can do is send
 * a message the server then drops.
 */
export async function setCaptureSettingsAction(
  accountId: string,
  settings: CaptureSettings,
): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  try {
    await setCaptureSettings({ accountId, settings, actorId: admin.id, actorType: 'admin' })
    revalidatePath('/accounts')
    return { ok: true, message: 'Capture settings saved.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save.' }
  }
}

export async function acknowledgeAlertAction(eventId: string): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  try {
    await acknowledgeAlert({ eventId, actorId: admin.id })
    revalidatePath('/accounts')
    return { ok: true, message: 'Acknowledged.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not acknowledge.' }
  }
}
