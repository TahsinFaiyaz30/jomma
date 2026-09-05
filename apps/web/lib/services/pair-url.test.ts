import { describe, expect, it, vi } from 'vitest'

/*
 * `devices.ts` is server-only and opens a database connection at import time.
 * Neither matters for a string builder, and neither should be needed to assert
 * the shape of the one URL that has to survive a round trip through a QR code,
 * a stranger's scanner app, and an Android intent.
 */
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@jomma/shared/env', () => ({
  env: () => ({ APP_URL: 'https://pay.example.com' }),
}))

const { pairUrl } = await import('./devices')

const CODE = 'gRbbEeuA1eFl0NTepZUxd2EqDmOE_o6sU06YutTy97s'

describe('pairUrl', () => {
  it('builds the URL the QR encodes', () => {
    expect(pairUrl(CODE)).toBe(`https://pay.example.com/pair/${CODE}`)
  })

  /*
   * The failure this test exists for.
   *
   * `APP_URL=https://pay.example.com/` is an entirely reasonable thing to write
   * in an env file, and naive concatenation turns it into `…com//pair/<code>`.
   * The app rejects that — `PairingLink.parse` requires the path to start with
   * exactly `/pair/` — so provisioning would break for that deployment and only
   * that deployment, with a QR that looks perfectly fine and an app that says
   * "that is not a Jomma QR code".
   */
  it('does not double the slash when APP_URL ends in one', () => {
    expect(pairUrl(CODE, 'https://pay.example.com/')).toBe(`https://pay.example.com/pair/${CODE}`)
    expect(pairUrl(CODE, 'https://pay.example.com///')).toBe(`https://pay.example.com/pair/${CODE}`)
  })

  it('keeps an explicit port, for instances not on 443', () => {
    expect(pairUrl(CODE, 'https://192.168.1.50:8443')).toBe(
      `https://192.168.1.50:8443/pair/${CODE}`,
    )
  })

  it('puts the code in the path, never in a query string', () => {
    // Query strings reach browser history, `Referer` headers and access logs
    // far more readily than paths do, and this one is a credential.
    const url = new URL(pairUrl(CODE))
    expect(url.search).toBe('')
    expect(url.pathname).toBe(`/pair/${CODE}`)
  })
})
