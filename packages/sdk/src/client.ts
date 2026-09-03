import { randomUUID } from 'node:crypto'
import { JommaError } from './errors.js'
import type {
  AccountSummary,
  CreateIntentParams,
  Intent,
  SubmissionParams,
  SubmissionResult,
} from './types.js'
import { constructEvent } from './webhooks.js'

export interface JommaOptions {
  apiKey: string
  /** Defaults to the public Jomma URL for your deployment. */
  baseUrl?: string
  /** Per-request timeout. Default 15s. */
  timeoutMs?: number
  /** Retries on 429, 5xx, and network failures. Default 2. */
  maxRetries?: number
  fetch?: typeof globalThis.fetch
}

interface RequestOptions {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  idempotencyKey?: string
  /** GET is safe to retry; a POST is only retried when it carries an idempotency key. */
  retryable: boolean
}

const DEFAULT_BASE_URL = 'http://localhost:3000'

/**
 * The Jomma client.
 *
 * Thin by design: types, signing, and retries. Anything that decides what a
 * payment means belongs on the server, where there is exactly one copy of it.
 */
export class Jomma {
  readonly intents: IntentsResource
  readonly submissions: SubmissionsResource
  readonly accounts: AccountsResource
  readonly webhooks: WebhooksResource

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: JommaOptions) {
    if (!options.apiKey) throw new Error('Jomma: apiKey is required.')

    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxRetries = options.maxRetries ?? 2
    this.fetchImpl = options.fetch ?? globalThis.fetch

    this.intents = new IntentsResource(this)
    this.submissions = new SubmissionsResource(this)
    this.accounts = new AccountsResource(this)
    this.webhooks = new WebhooksResource()
  }

  /** @internal */
  async request<T>(options: RequestOptions): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
        }
        if (options.body !== undefined) headers['content-type'] = 'application/json'
        if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey

        const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
          method: options.method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        })

        const text = await response.text()
        const json: unknown = text ? JSON.parse(text) : {}

        if (response.ok) return json as T

        const error = toJommaError(json, response.status)

        // Only retry when the server said the state might change, and only when
        // replaying is safe. Retrying a non-idempotent create would allocate a
        // second reference code and a second amount lock.
        if (options.retryable && error.retryable && attempt < this.maxRetries) {
          lastError = error
          await sleep(backoffMs(attempt, response.headers.get('retry-after')))
          continue
        }

        throw error
      } catch (caught) {
        if (caught instanceof JommaError) throw caught

        lastError = caught
        if (!options.retryable || attempt >= this.maxRetries) {
          throw new JommaError({
            code: 'internal_error',
            message: caught instanceof Error ? caught.message : 'Request failed',
            status: 0,
          })
        }
        await sleep(backoffMs(attempt, null))
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Request failed')
  }
}

class IntentsResource {
  constructor(private readonly client: Jomma) {}

  /**
   * Creates a payment request.
   *
   * Pass `idempotencyKey` — ideally your own order id. Without one a retried
   * request allocates a second reference code and a second amount lock, which
   * is exactly the collision the lock exists to prevent.
   */
  async create(params: CreateIntentParams): Promise<Intent> {
    const idempotencyKey = params.idempotencyKey ?? randomUUID()

    return this.client.request<Intent>({
      method: 'POST',
      path: '/v1/intents',
      idempotencyKey,
      // Safe to retry precisely because it carries the key.
      retryable: true,
      body: {
        amount: params.amount,
        client_reference: params.clientReference,
        payer_msisdn: params.payerMsisdn ?? undefined,
        provider: params.provider ?? 'any',
        ttl_seconds: params.ttlSeconds,
        metadata: params.metadata,
      },
    })
  }

  /** Poll this from the pay page every 2–3 seconds. */
  async get(intentId: string): Promise<Intent> {
    return this.client.request<Intent>({
      method: 'GET',
      path: `/v1/intents/${encodeURIComponent(intentId)}`,
      retryable: true,
    })
  }

  /** Releases the lock and expires the code. Safe on an already-cancelled intent. */
  async cancel(intentId: string): Promise<Intent> {
    return this.client.request<Intent>({
      method: 'POST',
      path: `/v1/intents/${encodeURIComponent(intentId)}/cancel`,
      retryable: true,
    })
  }

  /** Holds an order while a buyer tops up. Throws `lock_taken` if the amount went. */
  async extend(intentId: string, ttlSeconds: number): Promise<Intent> {
    return this.client.request<Intent>({
      method: 'POST',
      path: `/v1/intents/${encodeURIComponent(intentId)}/extend`,
      body: { ttl_seconds: ttlSeconds },
      retryable: false,
    })
  }
}

class SubmissionsResource {
  constructor(private readonly client: Jomma) {}

  /**
   * The manual path. Returns one of nine resolutions plus the numbers behind it.
   *
   * Jomma does not supply user-facing copy — different clients word things
   * differently. Branch on `resolution` and write your own.
   */
  async create(params: SubmissionParams): Promise<SubmissionResult> {
    return this.client.request<SubmissionResult>({
      method: 'POST',
      path: '/v1/submissions',
      // Not retried: submissions are rate limited to 5 per intent per hour, and
      // burning attempts on a network blip is the wrong trade.
      retryable: false,
      body: {
        intent_id: params.intentId,
        trx_id: params.trxId,
        sender_msisdn: params.senderMsisdn ?? undefined,
        claimed_amount: params.claimedAmount ?? undefined,
      },
    })
  }
}

class AccountsResource {
  constructor(private readonly client: Jomma) {}

  /** Check before rendering a pay page. */
  async list(): Promise<AccountSummary[]> {
    const result = await this.client.request<{ accounts: AccountSummary[] }>({
      method: 'GET',
      path: '/v1/accounts',
      retryable: true,
    })
    return result.accounts
  }
}

class WebhooksResource {
  /** Verifies a signature and returns the event. Throws on bad or stale. */
  construct = constructEvent
}

function toJommaError(json: unknown, status: number): JommaError {
  const body = json as
    | {
        error?: {
          code?: string
          message?: string
          request_id?: string
          details?: unknown
        }
      }
    | undefined

  return new JommaError({
    code: (body?.error?.code as JommaError['code']) ?? 'internal_error',
    message: body?.error?.message ?? `Request failed with status ${status}`,
    status,
    requestId: body?.error?.request_id ?? null,
    details: body?.error?.details,
  })
}

/** Exponential backoff with jitter, unless the server told us when to come back. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000)
  }
  const base = 2 ** attempt * 250
  return base + Math.random() * base
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
