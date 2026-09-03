'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { acknowledgeAlert, setAccountStatus } from '@/lib/services/account-admin'
import {
  createDeviceWithProvisioning,
  revokeDevice,
  rotateDeviceToken,
} from '@/lib/services/devices'

export interface DeviceActionResult {
  ok: boolean
  message: string
  /** Shown once and never again — the QR image, or a rotated token. */
  secret?: { kind: 'qr'; dataUrl: string; expiresAt: string } | { kind: 'token'; value: string }
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
      message: 'Scan this from the notifier app. It expires in 15 minutes.',
      secret: { kind: 'qr', dataUrl: qrDataUrl, expiresAt: payload.expires_at },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not add device.' }
  }
}

export async function rotateTokenAction(deviceId: string): Promise<DeviceActionResult> {
  const admin = await requireAdmin()

  try {
    const { deviceToken } = await rotateDeviceToken({ deviceId, actorId: admin.id })
    revalidatePath('/accounts')
    return {
      ok: true,
      // The old token stopped working the moment this committed.
      message: 'Rotated. The previous token is already invalid.',
      secret: { kind: 'token', value: deviceToken },
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
