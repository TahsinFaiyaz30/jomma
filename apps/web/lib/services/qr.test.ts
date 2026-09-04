import { describe, expect, it, vi } from 'vitest'

// The origin resolver falls back to configuration, and pulling the real loader
// in would make these tests depend on a populated .env to assert header
// parsing. The fallback only has to be *identifiable*, not real.
vi.mock('@jomma/shared/env', () => ({
  env: () => ({ APP_URL: 'https://configured.example' }),
}))

const { payPageUrl, requestOrigin } = await import('./qr')

const ID = 'int_01M1P9BWNZFT3VDY1K440YAPWA'

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

describe('requestOrigin', () => {
  it('uses the host the request arrived on', () => {
    expect(requestOrigin(get('http://localhost:3000/api/pay/x/qr'))).toBe('http://localhost:3000')
  })

  it('prefers the forwarded host behind a proxy', () => {
    const request = get('http://10.0.0.4:3000/api/pay/x/qr', {
      'x-forwarded-host': 'pay.merchant.com',
      'x-forwarded-proto': 'https',
    })

    expect(requestOrigin(request)).toBe('https://pay.merchant.com')
  })

  it('takes the first protocol from a forwarded chain', () => {
    // Two proxies deep, `x-forwarded-proto` is a list and the client's is first.
    const request = get('http://10.0.0.4/api/pay/x/qr', {
      'x-forwarded-host': 'pay.merchant.com',
      'x-forwarded-proto': 'https, http',
    })

    expect(requestOrigin(request)).toBe('https://pay.merchant.com')
  })

  it('does not downgrade an https buyer to http', () => {
    // TLS terminates at the proxy, so the inbound request says http. Believing
    // it would put an http link in the QR of an https checkout.
    const request = get('http://10.0.0.4/api/pay/x/qr', {
      host: 'pay.merchant.com',
      'x-forwarded-proto': 'https',
    })

    expect(requestOrigin(request)).toBe('https://pay.merchant.com')
  })

  it('falls back when the host carries a path', () => {
    // A header like this is how a link gets a suffix it was never meant to
    // have. There is no salvaging it, so configuration wins instead.
    const request = get('http://localhost:3000/api/pay/x/qr', {
      'x-forwarded-host': 'evil.example/pay',
    })

    expect(requestOrigin(request)).toBe('https://configured.example')
  })

  it('falls back on a host with a space or a scheme in it', () => {
    for (const host of ['evil.example evil2.example', 'https://evil.example', 'evil.example?a=b']) {
      expect(requestOrigin(get('http://localhost:3000/x', { 'x-forwarded-host': host }))).toBe(
        'https://configured.example',
      )
    }
  })

  it('falls back on a protocol that is not http or https', () => {
    const request = get('http://localhost:3000/x', {
      'x-forwarded-host': 'pay.merchant.com',
      'x-forwarded-proto': 'javascript',
    })

    expect(requestOrigin(request)).toBe('https://configured.example')
  })
})

describe('payPageUrl', () => {
  it('builds an absolute link', () => {
    expect(payPageUrl(ID, 'https://pay.merchant.com')).toBe(`https://pay.merchant.com/pay/${ID}`)
  })

  it('does not double the slash on an origin with a trailing one', () => {
    expect(payPageUrl(ID, 'https://pay.merchant.com/')).toBe(`https://pay.merchant.com/pay/${ID}`)
  })

  it('falls back to the configured origin', () => {
    expect(payPageUrl(ID)).toBe(`https://configured.example/pay/${ID}`)
  })
})
