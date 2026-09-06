import { CAPTURE_SOURCES, DEVICE_REPORTABLE_EVENT_KINDS, PROVIDER_PREFERENCES } from '@jomma/shared'
import { z } from 'zod'

/**
 * Zod at every boundary. Money is an integer count of poisha — no floats, no
 * decimal strings, and a positive lower bound so a zero-taka intent cannot be
 * created to farm reference codes.
 */

/**
 * Text that is going into Postgres.
 *
 * Postgres `text` cannot hold a NUL byte, and neither the driver nor Zod
 * objects to one on the way in. A JSON body carrying one inside a string is
 * perfectly valid JSON, Zod accepts it as a string, the driver forwards it,
 * and the database rejects it at the very end with an unhandled error -- so
 * the caller gets a 500 for input that validation was supposed to have
 * caught. That is a false promise from the validation layer, and a reliable
 * way for anyone holding a key to make the intents endpoint throw.
 *
 * Every other C0 control goes too. Those survive the round trip but arrive
 * invisible: a reference carrying a backspace or a line feed renders as
 * something other than what was sent, on a dashboard where an operator is
 * comparing it against a message a customer read off their phone.
 *
 * Checked by code point rather than by regex. A character class of control
 * characters has to be written with escapes that are easy to get subtly wrong
 * and impossible to review by eye, and it trips the lint rule that exists to
 * catch exactly that mistake.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * The same guard for text that is genuinely multi-line.
 *
 * A provider's SMS runs to four or five lines and a buyer writing a note about
 * a refund uses the return key, so `safeText` is the wrong instrument there —
 * it would reject ordinary traffic. What still cannot be allowed is a NUL,
 * which Postgres `text` will not store at all: `raw` on the capture endpoint
 * accepted one, the driver forwarded it, and the insert threw a 500 for input
 * validation had already blessed.
 *
 * So tab, line feed and carriage return are let through and every other C0
 * control is not. Those neither belong in a phone message nor survive being
 * displayed on a dashboard where an operator is comparing the text against
 * what a customer is reading off their own screen.
 */
export const multilineText = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) => {
        for (const character of value) {
          const code = character.codePointAt(0) ?? 0
          if (code === 0x09 || code === 0x0a || code === 0x0d) continue
          if (code < 0x20 || code === 0x7f) return false
        }
        return true
      },
      { message: 'Control characters are not allowed.' },
    )

/** A single-line string that is safe to store and safe to display. */
export const safeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !hasControlCharacter(value), {
      message: 'Control characters are not allowed.',
    })

export const poishaSchema = z
  .number()
  .int('Amount must be an integer number of poisha.')
  .positive('Amount must be greater than zero.')
  .max(2_000_000_000, 'Amount exceeds the maximum a single transaction can carry.')

/** Accepts `8801712345678`, `01712345678`, `+880 1712-345678`. */
export const msisdnSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .refine((value) => !hasControlCharacter(value), {
    message: 'Control characters are not allowed.',
  })
  .refine((value) => value.replace(/\D/g, '').length >= 10, {
    message: 'Not a valid Bangladeshi mobile number.',
  })

export const trxIdSchema = z
  .string()
  .trim()
  .min(4, 'A TrxID is at least 4 characters.')
  .max(40)
  .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))

export const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 4096, {
    message: 'Metadata must serialise to 4KB or less.',
  })

/**
 * A redirect target for the hosted pay page.
 *
 * Absolute http(s) only. A relative URL, a `javascript:` URL or a protocol
 *-relative `//evil.example` are all rejected here; the host is checked against
 * the app's allowlist later, once we know which app is asking.
 */
const redirectUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  }, 'Must be an absolute http(s) URL')

export const createIntentSchema = z.object({
  amount: poishaSchema,
  client_reference: safeText(255).min(1),
  payer_msisdn: msisdnSchema.optional().nullable(),
  provider: z.enum(PROVIDER_PREFERENCES).default('any'),
  ttl_seconds: z.number().int().min(60).max(3600).optional(),
  metadata: metadataSchema.optional(),

  /** Where the hosted pay page sends the buyer on success / on cancel. */
  return_url: redirectUrlSchema.optional().nullable(),
  cancel_url: redirectUrlSchema.optional().nullable(),
})
export type CreateIntentInput = z.infer<typeof createIntentSchema>

export const extendIntentSchema = z.object({
  ttl_seconds: z.number().int().min(60).max(3600),
})

export const createSubmissionSchema = z.object({
  intent_id: safeText(128).min(1),
  trx_id: trxIdSchema,
  sender_msisdn: msisdnSchema.optional().nullable(),
  claimed_amount: poishaSchema.optional().nullable(),
})
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>

/* ── Device API ──────────────────────────────────────────────────────────── */

export const captureItemSchema = z.object({
  local_id: safeText(64).min(1),
  source: z.enum(
    CAPTURE_SOURCES.filter((s) => s === 'notification' || s === 'sms') as ['notification', 'sms'],
  ),
  package: safeText(128).optional().nullable(),
  /**
   * The message, verbatim. Stored before anything tries to parse it, so the
   * schema imposes no shape beyond a length ceiling and the one byte Postgres
   * cannot hold — see `multilineText`. Line breaks are ordinary here.
   */
  raw: multilineText(4000).min(1),
  captured_at: z.iso.datetime({ offset: true }).optional().nullable(),
})

export const captureBatchSchema = z.object({
  // Batched: after an outage the device flushes its whole queue in one request
  // rather than hammering the endpoint.
  captures: z.array(captureItemSchema).min(1).max(200),
})
export type CaptureBatchInput = z.infer<typeof captureBatchSchema>

export const heartbeatSchema = z.object({
  battery: z.number().int().min(0).max(100).optional().nullable(),
  charging: z.boolean().optional().nullable(),
  network: z.enum(['wifi', 'mobile', 'none', 'unknown']).optional().nullable(),
  queue_depth: z.number().int().min(0).optional().nullable(),
  permissions: z.record(z.string(), z.boolean()).optional().nullable(),
  app_version: safeText(32).optional().nullable(),
})

/**
 * The phone changing what its account keeps.
 *
 * All three are required rather than optional. A partial update would race the
 * dashboard — two screens editing three booleans, each sending only what it
 * thinks changed, is how one of them ends up silently reverting the other. The
 * app always sends the full set it is displaying.
 */
export const captureSettingsSchema = z.object({
  cash_in: z.boolean(),
  outgoing: z.boolean(),
  other: z.boolean(),
})

export const deviceEventSchema = z.object({
  kind: z.enum(DEVICE_REPORTABLE_EVENT_KINDS),
  detail: safeText(500).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
})
