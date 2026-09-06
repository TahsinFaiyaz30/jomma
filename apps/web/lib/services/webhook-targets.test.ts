import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from './webhook-targets'

/**
 * Which addresses a webhook is allowed to reach on a shared instance.
 *
 * This is the part of the SSRF check that is pure arithmetic on an address, and
 * therefore the part most likely to be quietly wrong — an off-by-one on the
 * 172.16/12 boundary, or a notation nobody thought of. Both directions are
 * pinned: a rule that blocked everything would pass a test that only checked
 * blocking, and would also stop every real merchant receiving webhooks.
 */

describe('isPrivateAddress', () => {
  it('blocks loopback', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '::1']) {
      expect(isPrivateAddress(address)).toBe(true)
    }
  })

  it('blocks the cloud metadata address, which is the prize', () => {
    // 169.254.169.254 is where instance credentials live on every major host.
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
  })

  it('blocks the RFC1918 ranges', () => {
    for (const address of ['10.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255']) {
      expect(isPrivateAddress(address)).toBe(true)
    }
  })

  it('gets the edges of 172.16/12 right in both directions', () => {
    // The range is 172.16–172.31. Neighbours either side are public, and
    // treating them as private would silently break real endpoints.
    expect(isPrivateAddress('172.15.255.255')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('172.16.0.0')).toBe(true)
    expect(isPrivateAddress('172.31.0.1')).toBe(true)
  })

  it('blocks the other unroutable ranges', () => {
    for (const address of [
      '0.0.0.0',
      '100.64.0.1', // carrier-grade NAT
      '198.18.0.1', // benchmarking
      '224.0.0.1', // multicast
      '255.255.255.255',
    ]) {
      expect(isPrivateAddress(address)).toBe(true)
    }
  })

  it('sees through IPv4-mapped IPv6, which is the same destination rewritten', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('blocks IPv6 link-local and unique-local', () => {
    for (const address of ['fe80::1', 'fc00::1', 'fd12:3456::1', '::']) {
      expect(isPrivateAddress(address)).toBe(true)
    }
  })

  it('allows ordinary public addresses, or no merchant gets a webhook', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '203.0.113.10', '2606:4700::1111']) {
      expect(isPrivateAddress(address)).toBe(false)
    }
  })

  it('treats anything that is not an address as unsafe', () => {
    // Reached only with an already-resolved value, so a non-address here means
    // something upstream went wrong. Failing closed is the only safe read.
    for (const value of ['', 'not-an-address', '999.1.1.1', '10.0.0']) {
      expect(isPrivateAddress(value)).toBe(true)
    }
  })
})
