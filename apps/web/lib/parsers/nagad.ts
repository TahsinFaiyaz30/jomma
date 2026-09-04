import { failed, type MessageParser, type ParsedMessage } from './types'

/**
 * Nagad parser — deliberately not implemented.
 *
 * AGENTS.md open decision #2: the Nagad message format is unknown until it is
 * captured, and docs/matching.md is explicit that a parser must never be written
 * against an assumed format. A plausible-looking regex here would silently
 * mis-parse real money, which is worse than not parsing at all.
 *
 * What happens instead, and why it is safe:
 *
 *   - The capture endpoint stores `raw_message` before anything looks at it.
 *   - This returns `parse_status: 'failed'`, which raises a `parse_failure`
 *     alert rather than dropping the message.
 *   - The row sits in the manual queue with its full text, so an operator can
 *     apply it by hand today and a re-parse can pick it up once the real format
 *     is known.
 *
 * To finish it: capture the exact notification and SMS text for a Nagad
 * send-money and a Nagad cash-in, save them under ./fixtures, and write the
 * regexes against those strings.
 */

const PACKAGES = ['com.konasl.nagad'] as const

export function parseNagad(_raw: string): ParsedMessage {
  return failed(
    'No Nagad parser yet — the message format is unverified (AGENTS.md open decision #2). ' +
      'Raw message stored for manual review and later re-parse.',
  )
}

export const nagadParser: MessageParser = {
  provider: 'nagad',
  // The format is still unverified, so nothing here can be trusted to read a
  // real message. Checkout must not offer Nagad until this is true.
  automatic: false,
  packages: PACKAGES,
  claims(raw, packageName) {
    if (packageName && PACKAGES.includes(packageName as (typeof PACKAGES)[number])) return true
    return /nagad/i.test(raw)
  },
  parse: parseNagad,
}
