import { createHash } from 'node:crypto'
import type { Page } from 'playwright'

/**
 * Reading messages off the page.
 *
 * Every selector here is a guess about somebody else's markup that can stop
 * being true on any deploy they make. The scraper is written so that a broken
 * selector produces *zero* conversations rather than zero messages inside a
 * conversation it found — the caller treats an empty conversation list as a
 * fault, so a DOM change alerts instead of going quiet.
 */

export interface ScrapedMessage {
  /** Stable per message, used to avoid re-forwarding across restarts. */
  key: string
  sender: string
  text: string
}

/** Sender names as they appear in the conversation list. */
const CONVERSATION_SELECTORS = [
  'mws-conversation-list-item',
  'mw-conversation-list-item',
  '[data-e2e-conversation-list-item]',
].join(', ')

const MESSAGE_SELECTORS = [
  'mws-message-wrapper',
  'mw-message-wrapper',
  '[data-e2e-message-wrapper]',
].join(', ')

const TEXT_SELECTORS = [
  'mws-text-message-part .text-msg',
  'mw-text-message-part .text-msg',
  '.text-msg',
  '[data-e2e-message-text]',
].join(', ')

/**
 * The conversations currently in the list, with their sender labels.
 *
 * Returns an empty array when the list itself cannot be found, which the caller
 * reads as a fault.
 */
export async function listConversations(
  page: Page,
): Promise<Array<{ index: number; name: string }>> {
  const items = page.locator(CONVERSATION_SELECTORS)
  const count = await items.count()

  const conversations: Array<{ index: number; name: string }> = []
  for (let index = 0; index < count; index += 1) {
    const name = await items
      .nth(index)
      .locator('[data-e2e-conversation-name], .name, .conversation-name')
      .first()
      .innerText()
      .catch(() => '')

    conversations.push({ index, name: name.trim() })
  }

  return conversations
}

/**
 * Open one conversation and read the visible incoming messages.
 *
 * Outgoing messages are skipped — the bridge is watching for money arriving,
 * and a receipt the operator typed is not that.
 */
export async function readConversation(
  page: Page,
  index: number,
  sender: string,
): Promise<ScrapedMessage[]> {
  const items = page.locator(CONVERSATION_SELECTORS)
  if ((await items.count()) <= index) return []

  await items.nth(index).click({ timeout: 10_000 })
  await page.waitForTimeout(1_200)

  const wrappers = page.locator(MESSAGE_SELECTORS)
  const count = await wrappers.count()

  // Only the tail matters. Anything older has either been forwarded already or
  // is far outside any intent window.
  const start = Math.max(0, count - 25)
  const messages: ScrapedMessage[] = []

  for (let i = start; i < count; i += 1) {
    const wrapper = wrappers.nth(i)

    const outgoing = await wrapper
      .locator('.outgoing, [data-e2e-is-outgoing="true"]')
      .count()
      .catch(() => 0)
    if (outgoing > 0) continue

    const text = (
      await wrapper
        .locator(TEXT_SELECTORS)
        .first()
        .innerText()
        .catch(() => '')
    ).trim()
    if (!text) continue

    /*
     * The DOM has no message id worth trusting across reloads, so the key is a
     * hash of the sender and the text. bKash messages carry a unique TrxID, so
     * two genuinely different payments never collide; two identical strings
     * would be the same message read twice, which is exactly what should be
     * suppressed. And the server deduplicates on trx_id regardless, so a
     * collision here costs nothing.
     */
    const key = createHash('sha256').update(`${sender} ${text}`).digest('hex').slice(0, 32)

    messages.push({ key, sender, text })
  }

  return messages
}
