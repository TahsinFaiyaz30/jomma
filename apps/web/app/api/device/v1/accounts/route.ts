import { PROVIDERS } from '@jomma/shared'
import { z } from 'zod'
import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { addAccountFromSim, listSimOptions } from '@/lib/services/sim-accounts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  subscription_id: z.number().int(),
  provider: z.enum(PROVIDERS),
})

/**
 * GET /device/v1/accounts — what this phone could add, and what it already has.
 *
 * The same list the dashboard shows, answered to the phone that reported it, so
 * the two screens cannot disagree about which SIMs are present or which are
 * already spoken for.
 */
export const GET = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request, context)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  /*
   * `?provider=` narrows what "already taken" means. One SIM can hold a bKash
   * and a Nagad account, so a number is only unavailable for the wallet it is
   * already used for — asked without one, a SIM is offered until every provider
   * is spoken for.
   */
  const asked = new URL(request.url).searchParams.get('provider')
  const provider = PROVIDERS.find((each) => each === asked)

  const found = await listSimOptions({
    businessId: device.businessId,
    deviceId: device.deviceId,
    provider,
  })
  if (!found) throw ApiError.notFound('This phone is not paired to a business.')

  return {
    status: 200,
    body: {
      sims: found.sims.map((sim) => ({
        subscription_id: sim.subscription_id,
        slot_index: sim.slot_index,
        carrier_name: sim.carrier_name,
        msisdn: sim.msisdn,
        blocked_reason: sim.blockedReason,
      })),
      request_id: context.requestId,
    },
  }
})

/**
 * POST /device/v1/accounts — the phone adding a number it can see.
 *
 * ## Why a phone may do this at all
 *
 * Approval is the trust boundary, and it is the *handset* that gets approved.
 * Somebody at the dashboard looked at a phone that had scanned a code and said
 * yes to it; `authenticateDevice` refuses anything still `awaiting_approval`.
 * After that the phone manages the numbers on its own business rather than
 * asking permission for each one — which is the point of holding it.
 *
 * The blast radius of a stolen device token is bounded by what an account
 * actually is when it is created: `disabled`, routing nothing, invisible to
 * checkout until a human enables it. So the worst this adds is a row in a list
 * the merchant is looking at, and it is written to the audit trail as
 * `actorType: 'device'` rather than being indistinguishable from an admin.
 *
 * ## What it does not decide
 *
 * The number. That comes off the SIM, re-read here from what this phone last
 * reported rather than taken from the request — the body names a subscription,
 * never an msisdn, so a phone cannot claim a number it cannot see.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request, context)
  enforceRateLimit(context, 'device:capture', device.rateKey)

  const body = await parseBody(request, bodySchema)

  try {
    const added = await addAccountFromSim({
      businessId: device.businessId,
      deviceId: device.deviceId,
      subscriptionId: body.subscription_id,
      provider: body.provider,
      actorId: null,
      actorType: 'device',
    })

    return {
      status: 201,
      body: {
        msisdn: added.msisdn,
        provider: body.provider,
        /*
         * The phone does not need to do anything with this. A pairing code has
         * already been queued as a command, and the next heartbeat redeems it
         * exactly as it redeems a scanned QR — so the credential for the new
         * number is issued over the path that is already single-use, expiring
         * and rate limited.
         */
        status: 'added',
        request_id: context.requestId,
      },
    }
  } catch (error) {
    // These are the merchant's own rules — already trading on this provider, a
    // SIM that has been pulled, a SIM that will not say its number — and each
    // is a sentence worth showing rather than a 500.
    throw new ApiError(
      'validation_failed',
      error instanceof Error ? error.message : 'Could not add that number.',
    )
  }
})
