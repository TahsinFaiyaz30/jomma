import type { z } from 'zod'

/**
 * The error contract from docs/api.md. Every response carries `request_id`,
 * including errors — it is what ties a client's support ticket to a log line and
 * to the dashboard's request inspector.
 */

export const ERROR_CODES = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  no_capacity: 409,
  lock_taken: 409,
  duplicate_submission: 409,
  rate_limited: 429,
  no_healthy_account: 503,
  internal_error: 500,
} as const

export type ErrorCode = keyof typeof ERROR_CODES

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: 'Bad or revoked key.',
  forbidden: 'That resource belongs to another app.',
  not_found: 'Unknown intent.',
  validation_failed: 'The request body failed validation.',
  no_capacity: 'No free amount slot on any healthy account. Retry shortly.',
  lock_taken: 'That amount has since been claimed by another intent.',
  duplicate_submission: 'That TrxID has already been applied elsewhere.',
  rate_limited: 'Too many requests.',
  no_healthy_account: 'No receiving account is currently accepting payments.',
  internal_error: 'Something went wrong on our side.',
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: unknown

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'ApiError'
    this.code = code
    this.status = ERROR_CODES[code]
    this.details = details
  }

  static unauthorized(message?: string) {
    return new ApiError('unauthorized', message)
  }
  static forbidden(message?: string) {
    return new ApiError('forbidden', message)
  }
  static notFound(message?: string) {
    return new ApiError('not_found', message)
  }
  static noCapacity(message?: string) {
    return new ApiError('no_capacity', message)
  }
  static lockTaken(message?: string) {
    return new ApiError('lock_taken', message)
  }
  static duplicateSubmission(message?: string) {
    return new ApiError('duplicate_submission', message)
  }
  static noHealthyAccount(message?: string) {
    return new ApiError('no_healthy_account', message)
  }
  static rateLimited(retryAfterSeconds: number, message?: string) {
    return new ApiError('rate_limited', message, {
      retry_after: retryAfterSeconds,
    })
  }

  /** Flattens a Zod failure into the `details` field clients read. */
  static validation(error: z.ZodError): ApiError {
    const details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    }))
    return new ApiError('validation_failed', 'The request body failed validation.', details)
  }
}
