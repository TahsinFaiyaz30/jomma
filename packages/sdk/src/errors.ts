import type { ErrorCode } from './types'

/**
 * Every Jomma error carries a `request_id`. Keep it — it is what turns a support
 * conversation from "a payment failed sometime yesterday" into one log line.
 */
export class JommaError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly requestId: string | null
  readonly details: unknown

  constructor(options: {
    code: ErrorCode
    message: string
    status: number
    requestId?: string | null
    details?: unknown
  }) {
    super(options.message)
    this.name = 'JommaError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId ?? null
    this.details = options.details
  }

  /** True when retrying the same request later could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.code === 'rate_limited' ||
      this.code === 'no_capacity' ||
      this.code === 'no_healthy_account' ||
      this.status >= 500
    )
  }
}

/** Thrown by `webhooks.construct` — never treat a failure here as a soft error. */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignatureVerificationError'
  }
}
