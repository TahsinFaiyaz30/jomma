import { env } from '@jomma/shared/env'
import pino from 'pino'

/**
 * Structured logs.
 *
 * `raw_message` contains buyer phone numbers, and so do parsed sender fields.
 * The redaction list below is not optional — AGENTS.md treats those columns as
 * PII and forbids them in logs or in anything shipped to an error tracker.
 */

const REDACTED = [
  'raw',
  'rawMessage',
  'raw_message',
  'msisdn',
  'senderMsisdn',
  'sender_msisdn',
  'payerMsisdn',
  'payer_msisdn',
  'expectedMsisdn',
  'token',
  'apiKey',
  'secret',
  'authorization',
  'req.headers.authorization',
  '*.rawMessage',
  '*.raw_message',
  '*.senderMsisdn',
  '*.sender_msisdn',
  '*.msisdn',
]

export const logger = pino({
  level: env().LOG_LEVEL,
  redact: { paths: REDACTED, censor: '[redacted]' },
  base: { service: 'jomma-web' },
  ...(env().NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
})

/** A child logger bound to one request. Every line carries the request id. */
export function requestLogger(requestId: string, extra: Record<string, unknown> = {}) {
  return logger.child({ requestId, ...extra })
}

/**
 * Last four digits only. Use anywhere a number has to appear in a log line at
 * all — an operator can still correlate, but the log is not a phone book.
 */
export function redactMsisdn(msisdn: string | null | undefined): string {
  if (!msisdn) return '—'
  return `…${msisdn.replace(/\D/g, '').slice(-4)}`
}
