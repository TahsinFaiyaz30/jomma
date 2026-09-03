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
 * The provider comes from the receiving account the device is bound to, so a
 * capture is parsed as bKash because it landed on the bKash number — not because
 * the text happened to look like a bKash message. The package id is only a
 * cross-check.
 */
export function parseMessage(
  provider: Provider,
  raw: string,
  packageName?: string | null,
): ParsedMessage {
  const parser = PARSERS[provider]
  if (!parser) return failed(`No parser registered for provider "${provider}"`)

  // A notification from an unrelated app that got past the device-side filter.
  if (!parser.claims(raw, packageName)) {
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
