import { env } from '@jomma/shared/env'
import pino from 'pino'

/** Same redaction rules as the web app: no msisdns, no raw messages, no secrets. */
export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: 'jomma-worker' },
  redact: {
    paths: [
      'secret',
      'token',
      'msisdn',
      'senderMsisdn',
      'sender_msisdn',
      'rawMessage',
      'raw_message',
      '*.secret',
      '*.sender_msisdn',
      '*.raw_message',
      'payload.data.sender_msisdn',
    ],
    censor: '[redacted]',
  },
  ...(env().NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
})
