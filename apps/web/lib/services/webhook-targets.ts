import 'server-only'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isServiceMode } from '@jomma/shared/env'

/**
 * Where a webhook is allowed to be sent.
 *
 * A webhook endpoint is a URL a merchant types in, and Jomma's server then makes
 * a POST to it on every payment event. That is a request originating inside the
 * deployment's network, aimed wherever the merchant says — server-side request
 * forgery, unless something narrows it.
 *
 * The delivery record makes it worse than blind. `last_status_code` and
 * `last_error` are both shown back on the endpoint's own page, so the merchant
 * reads the result: `ECONNREFUSED` for a closed port, a timeout for a filtered
 * one, an HTTP status for something listening. That is a port scanner of the
 * private network with a dashboard on top. And the POST body carries fields the
 * merchant chose — `client_reference`, `metadata` — so the bytes arriving at
 * whatever is listening are partly theirs too.
 *
 * ## Why this depends on the deployment mode
 *
 * Self-hosted, the merchant *is* the operator. Their shop's backend is very
 * often `http://localhost:3001`, and there is no boundary being crossed by
 * reaching it: it is their server, their network, their own webhook. Refusing
 * private addresses there would break the ordinary setup and protect nobody —
 * anyone who can register the endpoint already has a shell on the box.
 *
 * As a service, the merchant is a stranger and the network holds other
 * merchants' data. So the rule only bites in service mode. That is not a
 * weaker check for self-hosters; it is the same question having a different
 * answer when the person asking owns the machine.
 *
 * ## What this does not do
 *
 * A name that resolves publicly now and privately a moment later still gets
 * through — the resolution here and the one inside `fetch` are two separate
 * lookups. Closing that needs the connection pinned to the address that was
 * checked, which Node's fetch does not offer. `redirect: 'error'` on the
 * delivery closes the other half, where a public URL answers 302 to an internal
 * one.
 */

/** Hostnames that are a private target by name rather than by address. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa']

export class WebhookTargetError extends Error {}

/**
 * Checks a webhook URL, resolving its host when the deployment is shared.
 *
 * Throws `WebhookTargetError` with something the merchant can act on. Returns
 * the parsed URL so callers store the normalised form.
 */
export async function assertDeliverableUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new WebhookTargetError('That is not a valid URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookTargetError('The URL must start with http:// or https://.')
  }

  // Self-hosted: their machine, their network, their call.
  if (!isServiceMode()) return url

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new WebhookTargetError('Webhooks must point at a public address.')
  }

  // A literal address needs no lookup, and must not get one — `dns.lookup` on
  // an IP happily echoes it back, which would read as a successful resolution.
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) {
      throw new WebhookTargetError('Webhooks must point at a public address.')
    }
    return url
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new WebhookTargetError('That hostname does not resolve.')
  }

  // Every answer, not the first: a name resolving to both a public and a
  // private address would otherwise pass on the public one and connect to
  // whichever the request happens to pick.
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new WebhookTargetError('Webhooks must point at a public address.')
  }

  return url
}

/** True for anything that is not routable on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address.toLowerCase())
  return true
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a = 0, b = 0] = parts

  if (a === 0) return true // this network
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 192 && b === 0) return true // protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast and reserved

  return false
}

function isPrivateIpv6(address: string): boolean {
  if (address === '::' || address === '::1') return true
  if (address.startsWith('fe80')) return true // link-local
  // Unique local: fc00::/7.
  if (/^f[cd]/.test(address)) return true

  // An IPv4-mapped address is an IPv4 destination wearing a different notation,
  // so it has to be judged as one -- ::ffff:127.0.0.1 is loopback.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])

  return false
}
