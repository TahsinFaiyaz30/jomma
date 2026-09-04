import { env } from '@jomma/shared/env'
import pino from 'pino'

const config = env()

export const logger = pino({
  name: 'jomma-bridge',
  level: config.LOG_LEVEL,
  /*
   * Message bodies are the whole payload here and they contain msisdns and
   * amounts. They go to the server, which stores them deliberately; they do not
   * go to a log file on whatever machine happens to run the scraper.
   */
  redact: {
    paths: ['raw', 'body.raw', 'text', 'device_token', 'provisioning_token'],
    censor: '[redacted]',
  },
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
})
