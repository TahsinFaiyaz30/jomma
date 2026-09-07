import 'server-only'

import type { DeviceCommand, Provider, SimCard } from '@jomma/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { devices, receivingAccounts } from '@/lib/db/schema'
import { createReceivingAccount } from './account-admin'
import { createDeviceWithProvisioning } from './devices'

/**
 * Adding a number by picking the SIM it lives on.
 *
 * The old way was a form: somebody typed a bKash number into the dashboard, a
 * QR was generated for it, a phone scanned that, and then — separately, later,
 * on a different screen — somebody told the app which SIM that number was on.
 * Two facts entered by hand that had to agree, and nothing anywhere checking
 * that they did. When they disagreed the messages routed to the wrong account
 * or to none, and the only symptom was payments quietly not arriving.
 *
 * Now the phone reports its SIMs on every heartbeat, and choosing one is the
 * whole act: the number comes off the SIM, so there is nothing to mistype and
 * nothing to keep in step.
 */

export interface SimOption extends SimCard {
  /** Why this SIM cannot be chosen, or null when it can. */
  blockedReason: string | null
}

/**
 * The SIMs a phone last reported, each marked with whether it can be used.
 *
 * Returns reasons rather than filtering, because a SIM that is present and
 * unusable is a different thing from a SIM that is not there — and somebody
 * staring at a screen that omits the SIM they can see in their hand has no way
 * to find out which.
 */
export async function listSimOptions(options: {
  businessId: string
  deviceId: string
}): Promise<{ sims: SimOption[]; reportedAt: Date | null; deviceName: string } | null> {
  const device = await db.query.devices.findFirst({
    where: and(eq(devices.id, options.deviceId), eq(devices.businessId, options.businessId)),
  })
  if (!device) return null

  // Numbers this business already watches, so a SIM cannot be added twice.
  const taken = await db
    .select({ msisdn: receivingAccounts.msisdn, provider: receivingAccounts.provider })
    .from(receivingAccounts)
    .where(
      and(
        eq(receivingAccounts.businessId, options.businessId),
        inArray(receivingAccounts.status, ['active', 'degraded']),
      ),
    )

  const takenNumbers = new Set(taken.map((row) => row.msisdn))

  const sims = (device.sims ?? []).map((sim) => ({
    ...sim,
    blockedReason: blockedReason(sim, takenNumbers),
  }))

  return { sims, reportedAt: device.simsReportedAt, deviceName: device.name }
}

function blockedReason(sim: SimCard, takenNumbers: Set<string>): string | null {
  if (!sim.msisdn) {
    /*
     * The carrier never wrote the number to the SIM and IMS did not answer
     * either. Nothing can be done about it from here, and saying so beats an
     * empty row somebody stares at — see `SimCard.msisdn`.
     */
    return 'This SIM does not report its own number, so it cannot be added automatically.'
  }
  if (takenNumbers.has(sim.msisdn)) return 'Already set up on this business.'
  return null
}

export interface PairedPhone {
  id: string
  name: string
  /** How many SIMs it last reported, so a phone with none reads as needing help. */
  simCount: number
  /** Null for a phone that has never reported — an older app, or no permission. */
  simsReportedAt: Date | null
  /** False when the phone has switched this business off at its end. */
  sendingEnabled: boolean
  lastHeartbeatAt: Date | null
}

/**
 * The phones paired to a business, whether or not they watch a number yet.
 *
 * By business rather than through an account, which is the whole point: a phone
 * that has scanned the code and is reporting its SIMs has no account, and
 * joining through one would hide exactly the phone somebody is about to pick a
 * SIM from.
 */
export async function listPairedPhones(businessId: string): Promise<PairedPhone[]> {
  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      sims: devices.sims,
      simsReportedAt: devices.simsReportedAt,
      sendingEnabled: devices.sendingEnabled,
      lastHeartbeatAt: devices.lastHeartbeatAt,
    })
    .from(devices)
    .where(and(eq(devices.businessId, businessId), eq(devices.status, 'active')))

  /*
   * One row per handset, not per credential.
   *
   * A phone helping a business with both a bKash and a Nagad number holds a
   * credential for each, which is two `devices` rows with the same name. Listing
   * both would offer the same handset twice and show its SIMs twice, so they are
   * folded by name and the one that has reported most recently wins.
   */
  const byName = new Map<string, PairedPhone>()
  for (const row of rows) {
    const phone: PairedPhone = {
      id: row.id,
      name: row.name,
      simCount: row.sims?.length ?? 0,
      simsReportedAt: row.simsReportedAt,
      sendingEnabled: row.sendingEnabled,
      lastHeartbeatAt: row.lastHeartbeatAt,
    }
    const seen = byName.get(row.name)
    const fresher =
      !seen || (phone.simsReportedAt?.getTime() ?? 0) > (seen.simsReportedAt?.getTime() ?? 0)
    if (fresher) byName.set(row.name, phone)
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Turns a chosen SIM into a receiving account, and tells the phone to claim it.
 *
 * The credential is not sent down this path. A provisioning code is minted and
 * handed to the phone as a command, and the phone redeems it exactly as it
 * redeems a scanned QR — so the device token is issued to whoever is holding
 * the handset, over a path that is already single-use, expiring and rate
 * limited, rather than pushed down a channel and hoped about.
 *
 * The one-account-per-provider rule is checked here and backed by a unique
 * index. Both, because the index is partial — it covers accounts that are
 * trading — and a new account is created disabled, so the index alone would
 * accept a second bKash and only refuse it later, when somebody tried to enable
 * it, with an error about an index rather than about the rule.
 */
export async function addAccountFromSim(options: {
  businessId: string
  deviceId: string
  subscriptionId: number
  provider: Provider
  label?: string
  actorId: string
}): Promise<{ accountId: string; msisdn: string }> {
  const device = await db.query.devices.findFirst({
    where: and(eq(devices.id, options.deviceId), eq(devices.businessId, options.businessId)),
  })
  if (!device) throw new Error('That phone is not paired to this business.')

  const sim = (device.sims ?? []).find((row) => row.subscription_id === options.subscriptionId)
  if (!sim) {
    throw new Error('That SIM is no longer in the phone. Open the app and try again.')
  }

  /*
   * Re-checked here rather than trusted from the screen that offered it.
   *
   * The list came from a heartbeat, and heartbeats are minutes apart — the SIM
   * could have been pulled since. More to the point, this is a server action:
   * the subscription id arrives from a browser and is a claim, not a fact.
   */
  if (!sim.msisdn) {
    throw new Error('That SIM does not report its own number, so it cannot be added.')
  }

  /*
   * One account per provider, checked here as well as in the database.
   *
   * The unique index is partial — it covers accounts that are trading — and a
   * new account is created `disabled`, because checkout must not route to a
   * number before a phone is watching it. So the index alone would let a second
   * bKash be created and only refuse it later, at the moment somebody tried to
   * enable it, with an error about an index rather than about the rule.
   *
   * A `disabled` account does not block its own replacement: retiring one and
   * adding another is exactly how a merchant changes numbers.
   */
  const existing = await db.query.receivingAccounts.findFirst({
    where: and(
      eq(receivingAccounts.businessId, options.businessId),
      eq(receivingAccounts.provider, options.provider),
      inArray(receivingAccounts.status, ['active', 'degraded']),
    ),
  })
  if (existing) {
    throw new Error(
      `This business already has a ${options.provider} number (${existing.msisdn}). ` +
        'Disable it first if you are replacing it.',
    )
  }

  const account = await createReceivingAccount({
    businessId: options.businessId,
    provider: options.provider,
    msisdn: sim.msisdn,
    label: options.label?.trim() || `${sim.carrier_name || 'SIM'} · ${sim.msisdn}`,
    actorId: options.actorId,
  })

  /*
   * A pending device row for the new account, and a code for the phone.
   *
   * A second row rather than re-pointing the existing one: a phone helping a
   * business with both a bKash and a Nagad number holds one credential per
   * number, so revoking one leaves the other working. The phone groups them by
   * business itself — that is what its switcher is for.
   */
  const provisioning = await createDeviceWithProvisioning({
    receivingAccountId: account.id,
    name: device.name,
    actorId: options.actorId,
  })

  const command: DeviceCommand = {
    type: 'add_account',
    pair_url: provisioning.payload.pair_url,
    msisdn: account.msisdn,
    provider: options.provider,
  }

  /*
   * Appended, not assigned. The queue can already hold a rotation the phone has
   * not collected, and overwriting it would leave that device holding a token
   * the server has replaced.
   */
  await db
    .update(devices)
    .set({ pendingCommands: [...(device.pendingCommands ?? []), command] })
    .where(eq(devices.id, device.id))

  return { accountId: account.id, msisdn: account.msisdn }
}
