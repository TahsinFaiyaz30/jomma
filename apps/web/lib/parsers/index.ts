import type { Provider } from '@jomma/shared'
import { bkashParser } from './bkash'
import { nagadParser } from './nagad'
import { failed, type MessageParser, type ParsedMessage } from './types'

export const PARSERS: Record<Provider, MessageParser> = {
  bkash: bkashParser,
  nagad: nagadParser,
}

/**
 * Picks a parser and runs it. Never throws.
 *
 * The provider comes from the receiving account, so a capture is parsed as bKash
 * because it landed on the bKash number — not because the text happened to look
 * like a bKash message.
 *
 * `claims` is therefore only consulted when a package name was supplied, which
 * means the notification path. There it is doing real work: an unrelated app's
 * notification that got past the device-side filter should be rejected rather
 * than run through a payment parser.
 *
 * Everywhere else — SMS, manual entry, statement rows, the signed webhook —
 * there is no package name and no second opinion to have. Gating on the text
 * looking bKash-ish would silently drop real captures, because a bKash SMS does
 * not contain the word "bkash" and its TrxID does not reliably start with `BK`.
 * The parser runs, and if it cannot find an amount and a TrxID it fails on its
 * own terms, with the raw text already stored.
 */
export function parseMessage(
  provider: Provider,
  raw: string,
  packageName?: string | null,
): ParsedMessage {
  const parser = PARSERS[provider]
  if (!parser) return failed(`No parser registered for provider "${provider}"`)

  if (packageName && !parser.claims(raw, packageName)) {
    return failed(`Message does not look like a ${provider} transaction`)
  }

  try {
    return parser.parse(raw)
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Parser threw')
  }
}

export { takaToPoisha, toE164 } from './types'
export type { MessageParser, ParsedMessage }
export { bkashParser, nagadParser }
