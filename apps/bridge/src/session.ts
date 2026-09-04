import { mkdir } from 'node:fs/promises'
import { type BrowserContext, chromium, type Page } from 'playwright'
import type { BridgeConfig } from './config'
import { logger } from './logger'

/**
 * The Chromium session that holds the Messages pairing.
 *
 * A *persistent* context, not a fresh browser: the pairing lives in the profile
 * directory, and a bridge that had to be re-scanned on every restart would be
 * useless. The profile is therefore a credential — it is written with the same
 * care as the device token, and the README says to treat it that way.
 */

export const MESSAGES_URL = 'https://messages.google.com/web/conversations'

/**
 * Why the session is not usable.
 *
 * `signed_out` and `unrecognised` are deliberately handled identically by the
 * caller. AGENTS.md: a bridge that has stopped finding messages must be
 * indistinguishable from a bridge that is down. The distinction is kept only so
 * the alert detail can say which one it looked like.
 */
export type SessionFault = 'signed_out' | 'unrecognised' | 'unreachable'

export interface SessionHealth {
  ok: boolean
  fault: SessionFault | null
  detail: string | null
}

export class MessagesSession {
  private context: BrowserContext | null = null
  private page: Page | null = null

  constructor(private readonly config: BridgeConfig) {}

  async open(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page

    await mkdir(this.config.profileDir, { recursive: true })

    this.context = await chromium.launchPersistentContext(this.config.profileDir, {
      headless: !this.config.headed,
      viewport: { width: 1280, height: 900 },
      // Messages refuses to load in a browser it does not recognise, and the
      // headless default UA is exactly the sort of thing it does not recognise.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/140.0.0.0 Safari/537.36',
      locale: 'en-US',
      // Nothing here should ever be downloaded, and a scraper that can write to
      // disk from a page it does not control is a liability.
      acceptDownloads: false,
    })

    this.page = this.context.pages()[0] ?? (await this.context.newPage())
    this.page.setDefaultTimeout(20_000)

    await this.page.goto(MESSAGES_URL, { waitUntil: 'domcontentloaded' })
    return this.page
  }

  /**
   * Is the session usable right now?
   *
   * Checked before every poll rather than once at boot, because the pairing
   * expires on its own schedule and the failure is silent — the page simply
   * goes back to showing a QR code, and a scraper that only looked for messages
   * would report "nothing new" forever.
   */
  async health(): Promise<SessionHealth> {
    const page = this.page
    if (!page || page.isClosed()) {
      return { ok: false, fault: 'unreachable', detail: 'Browser page is not open.' }
    }

    try {
      // The pairing QR is the unambiguous signed-out tell.
      const qr = await page.locator('mw-qr-code, [data-e2e-qr-code], canvas[aria-label*="QR" i]')
      if (
        (await qr.count()) > 0 &&
        (await qr
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return { ok: false, fault: 'signed_out', detail: 'Messages is showing a pairing QR.' }
      }

      const signIn = page.getByText(/pair|sign in|remember this computer/i)
      if (
        (await signIn.count()) > 0 &&
        (await signIn
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return { ok: false, fault: 'signed_out', detail: 'Messages is asking to pair again.' }
      }

      // The conversation list is the one structure the scraper depends on. If it
      // is not there, the DOM changed and every selector below is suspect.
      const list = page.locator('mws-conversations-list, mw-conversation-list, [role="list"]')
      if ((await list.count()) === 0) {
        return {
          ok: false,
          fault: 'unrecognised',
          detail: 'Conversation list not found — the page structure has changed.',
        }
      }

      return { ok: true, fault: null, detail: null }
    } catch (error) {
      return {
        ok: false,
        fault: 'unreachable',
        detail: error instanceof Error ? error.message : 'Session check failed.',
      }
    }
  }

  /** Reload, for recovering from a transient navigation failure. */
  async reload(): Promise<void> {
    if (!this.page || this.page.isClosed()) {
      await this.open()
      return
    }
    await this.page.goto(MESSAGES_URL, { waitUntil: 'domcontentloaded' }).catch((error) => {
      logger.warn({ err: error }, 'reload failed')
    })
  }

  page_(): Page | null {
    return this.page && !this.page.isClosed() ? this.page : null
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {})
    this.context = null
    this.page = null
  }
}
