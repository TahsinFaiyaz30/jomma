import { describe, expect, it } from 'vitest'
import { SignatureVerificationError } from './errors'
import { constructEvent, signPayload } from './webhooks'

const SECRET = 'whsec_test_0123456789abcdef0123456789abcdef'

const BODY = JSON.stringify({
  id: 'evt_01J8XR4M9K',
  type: 'payment.succeeded',
  created_at: '2026-09-03T14:35:14Z',
  data: { intent_id: 'int_01J8X', amount: 120000 },
})

describe('constructEvent', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const header = signPayload(BODY, SECRET)
    const event = constructEvent(BODY, header, SECRET)
    expect(event.type).toBe('payment.succeeded')
    expect(event.id).toBe('evt_01J8XR4M9K')
  })

  it('rejects a tampered body', () => {
    const header = signPayload(BODY, SECRET)
    const tampered = BODY.replace('120000', '999999')
    expect(() => constructEvent(tampered, header, SECRET)).toThrow(SignatureVerificationError)
  })

  it('rejects the wrong secret', () => {
    const header = signPayload(BODY, SECRET)
    expect(() => constructEvent(BODY, header, 'whsec_someone_elses_secret_value')).toThrow(
      SignatureVerificationError,
    )
  })

  it('rejects a stale timestamp outside the tolerance', () => {
    const sixMinutesAgo = Math.floor(Date.now() / 1000) - 360
    const header = signPayload(BODY, SECRET, sixMinutesAgo)
    expect(() => constructEvent(BODY, header, SECRET)).toThrow(/outside the 300s tolerance/)
  })

  it('accepts a timestamp inside the tolerance', () => {
    const twoMinutesAgo = Math.floor(Date.now() / 1000) - 120
    const header = signPayload(BODY, SECRET, twoMinutesAgo)
    expect(() => constructEvent(BODY, header, SECRET)).not.toThrow()
  })

  it('rejects a future timestamp beyond the tolerance', () => {
    const later = Math.floor(Date.now() / 1000) + 600
    const header = signPayload(BODY, SECRET, later)
    expect(() => constructEvent(BODY, header, SECRET)).toThrow(SignatureVerificationError)
  })

  it('rejects a malformed or missing header', () => {
    expect(() => constructEvent(BODY, null, SECRET)).toThrow(/Missing X-Jomma-Signature/)
    expect(() => constructEvent(BODY, 'garbage', SECRET)).toThrow(SignatureVerificationError)
    expect(() => constructEvent(BODY, 't=123', SECRET)).toThrow(/no v1 signature/)
    expect(() => constructEvent(BODY, 'v1=abc', SECRET)).toThrow(/no timestamp/)
  })

  it('verifies against any v1 value, so a secret rotation still validates', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const valid = signPayload(BODY, SECRET, timestamp).split('v1=')[1] as string
    const header = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${valid}`
    expect(() => constructEvent(BODY, header, SECRET)).not.toThrow()
  })

  it('refuses an empty secret rather than verifying nothing', () => {
    const header = signPayload(BODY, SECRET)
    expect(() => constructEvent(BODY, header, '')).toThrow(/Missing webhook signing secret/)
  })

  it('rejects a signed body that is not JSON', () => {
    const raw = 'not json at all'
    const header = signPayload(raw, SECRET)
    expect(() => constructEvent(raw, header, SECRET)).toThrow(/not valid JSON/)
  })
})
