import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * The whole SSRF guard, not just its address arithmetic.
 *
 * Two things are worth proving here that the unit test cannot. That the mode
 * gate actually gates — self-hosters point webhooks at their own localhost
 * backend as a matter of course, and a check that broke them would be reverted
 * within a day. And that a *hostname* resolving into the private network is
 * refused, since an attacker types a name, not an address.
 */

const mode = vi.hoisted(() => ({ service: true }))

vi.mock('@jomma/shared/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jomma/shared/env')>()
  return { ...actual, isServiceMode: () => mode.service }
})

const { assertDeliverableUrl, WebhookTargetError } = await import('@/lib/services/webhook-targets')

const refuses = async (url: string) => {
  await expect(assertDeliverableUrl(url)).rejects.toBeInstanceOf(WebhookTargetError)
}

afterAll(() => {
  vi.restoreAllMocks()
})

describe('as a service, where merchants are strangers', () => {
  it('refuses a literal private address', async () => {
    mode.service = true
    for (const url of [
      'http://127.0.0.1:6379/',
      'http://10.0.0.5/admin',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:8080/',
    ]) {
      await refuses(url)
    }
  })

  it('refuses a hostname that resolves into the private network', async () => {
    // The realistic attack: nothing in the string looks like an address.
    mode.service = true
    await refuses('http://localhost:5432/')
    await refuses('https://foo.local/hook')
    await refuses('https://api.internal/hook')
  })

  it('refuses a scheme that is not http', async () => {
    mode.service = true
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/']) await refuses(url)
  })

  it('refuses something that is not a URL at all', async () => {
    mode.service = true
    await refuses('not a url')
  })

  it('still allows an ordinary public endpoint', async () => {
    // The check has to let real traffic through, or it has simply turned
    // webhooks off for everyone.
    mode.service = true
    const url = await assertDeliverableUrl('https://example.com/jomma/hook')
    expect(url.hostname).toBe('example.com')
  })
})

describe('self-hosted, where the merchant owns the machine', () => {
  it('allows localhost, which is where their own backend lives', async () => {
    mode.service = false
    const url = await assertDeliverableUrl('http://localhost:3001/webhooks/jomma')
    expect(url.port).toBe('3001')
  })

  it('allows a private address on their own network', async () => {
    mode.service = false
    await expect(assertDeliverableUrl('http://192.168.1.50/hook')).resolves.toBeTruthy()
  })

  it('still insists on http or https', async () => {
    // Not about the network. A `file://` endpoint is a malformed setting in any
    // deployment, and failing at delivery time would be a worse way to learn it.
    mode.service = false
    await refuses('file:///etc/passwd')
  })
})
