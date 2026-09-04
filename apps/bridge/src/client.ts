import { createHmac } from 'node:crypto'
import { formatSignatureHeader, SIGNATURE_HEADER, signingPayload } from '@jomma/shared'
import type { BridgeConfig } from './config'
import { logger } from './logger'

/**
 * The bridge's half of the wire.
 *
 * Captures go to the signed generic webhook, exactly as AGENTS.md specifies —
 * the bridge is not a capture device and does not get the device capture
 * endpoint. Health goes to the *device* endpoints, because AGENTS.md requires
 * the bridge to report on the same heartbeat mechanism as the Android app, so
 * that one worker job detects both going quiet.
 */

export class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeHttpError'
  }
}

export interface ProvisionResult {
  deviceId: string
  deviceToken: string
  accountMsisdn: string | null
}

export class JommaClient {
  constructor(private readonly config: BridgeConfig) {}

  /** First boot only: exchange the one-time value for a long-lived token. */
  async provision(deviceId: string, provisioningToken: string): Promise<ProvisionResult> {
    const response = await fetch(`${this.config.baseUrl}/device/v1/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, provisioning_token: provisioningToken }),
    })

    const body = (await response.json().catch(() => ({}))) as {
      device_token?: string
      device_id?: string
      account?: { msisdn?: string } | null
      error?: { message?: string }
    }

    if (!response.ok || !body.device_token) {
      throw new BridgeHttpError(
        response.status,
        body.error?.message ?? `Provisioning failed with ${response.status}`,
      )
    }

    return {
      deviceId: body.device_id ?? deviceId,
      deviceToken: body.device_token,
      accountMsisdn: body.account?.msisdn ?? null,
    }
  }

  /**
   * Forward one captured message.
   *
   * The raw text is sent verbatim and never parsed here. The bridge scrapes a
   * DOM that changes without notice; if it also tried to read amounts it would
   * be a second parser to keep in sync with the server's, and the two would
   * disagree at the worst possible moment.
   */
  async forward(options: {
    msisdn: string
    raw: string
  }): Promise<{ status: string; trxId: string | null; matched: boolean }> {
    const rawBody = JSON.stringify({
      msisdn: options.msisdn,
      raw: options.raw,
      source: 'bridge',
    })

    const timestamp = Math.floor(Date.now() / 1000)
    const digest = createHmac('sha256', this.config.signingSecret)
      .update(signingPayload(timestamp, rawBody))
      .digest('hex')

    const response = await fetch(`${this.config.baseUrl}/ingest/v1/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: formatSignatureHeader(timestamp, digest),
      },
      body: rawBody,
    })

    const body = (await response.json().catch(() => ({}))) as {
      status?: string
      trx_id?: string | null
      matched?: boolean
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new BridgeHttpError(
        response.status,
        body.error?.message ?? `Ingest rejected with ${response.status}`,
      )
    }

    return {
      status: body.status ?? 'accepted',
      trxId: body.trx_id ?? null,
      matched: body.matched ?? false,
    }
  }

  /**
   * The heartbeat. Sent only while the session is healthy — see index.ts. The
   * server alerts on the gap, so staying silent is how a broken bridge reports
   * itself.
   */
  async heartbeat(
    deviceToken: string,
    body: { queueDepth: number; appVersion: string; sessionOk: boolean },
  ): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/device/v1/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({
        network: 'wifi',
        queue_depth: body.queueDepth,
        app_version: body.appVersion,
        // Reusing the permissions map: for a scraper the equivalent of "can I
        // still read notifications" is "am I still signed in". A false here is
        // recorded as a lost permission and alerts critical, same as the phone.
        permissions: { messages_session: body.sessionOk },
      }),
    })

    if (!response.ok) {
      throw new BridgeHttpError(response.status, `Heartbeat rejected with ${response.status}`)
    }
  }

  /** An explicit alert, for things the gap detector cannot infer on its own. */
  async reportEvent(
    deviceToken: string,
    kind: 'bridge_session_lost' | 'service_restarted' | 'boot' | 'parse_hint',
    detail?: string | null,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch(`${this.config.baseUrl}/device/v1/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({ kind, detail: detail ?? null, payload: payload ?? {} }),
      })
    } catch (error) {
      // Best-effort by definition. If the bridge cannot even report that it is
      // broken, the heartbeat gap is the backstop.
      logger.warn({ err: error, kind }, 'could not report event')
    }
  }
}
