import { newRequestId } from '@jomma/shared'
import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { logger } from '@/lib/logger'
import { ApiError } from './errors'
import { consume, type RateLimitKey, type RateLimitResult } from './ratelimit'

/**
 * Route wrapper.
 *
 * Everything a route needs to get right and nothing it should have to remember:
 * a request id on every response, `X-RateLimit-*` on every response, JSON
 * parsing that fails as a 422 rather than a 500, and one place where an
 * unhandled throw becomes a shaped error body instead of a stack trace.
 */

export interface RequestContext {
  requestId: string
  log: ReturnType<typeof logger.child>
  /** Set by `withRateLimit`; merged into the response headers. */
  rateLimit: RateLimitResult | null
  ip: string | null
}

type Handler<T> = (request: Request, context: RequestContext) => Promise<T>

export function jsonResponse(
  body: unknown,
  status: number,
  context: RequestContext,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const headers: Record<string, string> = {
    'x-request-id': context.requestId,
    ...extraHeaders,
  }

  if (context.rateLimit) {
    headers['x-ratelimit-limit'] = String(context.rateLimit.limit)
    headers['x-ratelimit-remaining'] = String(context.rateLimit.remaining)
    headers['x-ratelimit-reset'] = String(context.rateLimit.reset)
  }

  return NextResponse.json(body, { status, headers })
}

function errorResponse(error: ApiError, context: RequestContext): NextResponse {
  const extraHeaders: Record<string, string> = {}
  if (error.code === 'rate_limited') {
    const retryAfter =
      (error.details as { retry_after?: number } | undefined)?.retry_after ??
      context.rateLimit?.retryAfter ??
      60
    extraHeaders['retry-after'] = String(retryAfter)
  }

  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        request_id: context.requestId,
        ...(error.details !== undefined && error.code === 'validation_failed'
          ? { details: error.details }
          : {}),
      },
    },
    error.status,
    context,
    extraHeaders,
  )
}

/** Wraps a route handler. The returned value is serialised as JSON with `status`. */
export function route(
  handler: Handler<{
    status: number
    body: unknown
    headers?: Record<string, string>
  }>,
) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = newRequestId()
    const ip = clientIp(request)
    const context: RequestContext = {
      requestId,
      log: logger.child({
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
      }),
      rateLimit: null,
      ip,
    }

    const startedAt = Date.now()

    try {
      const result = await handler(request, context)
      context.log.info({ status: result.status, ms: Date.now() - startedAt }, 'request')
      return jsonResponse(result.body, result.status, context, result.headers)
    } catch (error) {
      if (error instanceof ApiError) {
        // 4xx is the client's problem and expected traffic; log it at warn with
        // the IP, per the security note in AGENTS.md, and move on.
        context.log.warn(
          {
            code: error.code,
            status: error.status,
            ip,
            ms: Date.now() - startedAt,
          },
          'request rejected',
        )
        return errorResponse(error, context)
      }

      context.log.error({ err: error, ms: Date.now() - startedAt }, 'unhandled route error')
      return errorResponse(new ApiError('internal_error'), context)
    }
  }
}

/** Applies a rate limit and records the result so the headers go out either way. */
export function enforceRateLimit(
  context: RequestContext,
  rule: RateLimitKey,
  identifier: string,
): void {
  const result = consume(rule, identifier)
  context.rateLimit = result
  if (!result.ok) {
    context.log.warn({ rule, ip: context.ip }, 'rate limited')
    throw ApiError.rateLimited(result.retryAfter)
  }
}

/** Parses and validates a JSON body. A malformed body is a 422, never a 500. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    const text = await request.text()
    raw = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    throw new ApiError('validation_failed', 'Request body is not valid JSON.')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw ApiError.validation(parsed.error)
  return parsed.data
}

export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = schema.safeParse(params)
  if (!parsed.success) throw ApiError.validation(parsed.error)
  return parsed.data
}

/**
 * Best-effort client IP. Behind a reverse proxy this is whatever the proxy sets,
 * so it is only ever used for logging and coarse limiting, never for auth.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip')
}
