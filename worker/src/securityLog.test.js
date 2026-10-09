import { describe, it, expect, vi, afterEach } from 'vitest'
import { securityEvent, maskIp } from './securityLog.js'

afterEach(() => vi.restoreAllMocks())

const capture = () => {
  const lines = []
  vi.spyOn(console, 'warn').mockImplementation(s => lines.push(JSON.parse(s)))
  return lines
}

describe('maskIp', () => {
  it('IPv4 は /24、IPv6 は /48 まで残して伏せる', () => {
    expect(maskIp('203.0.113.57')).toBe('203.0.113.x')
    expect(maskIp('2001:db8:abcd:12:34::1')).toBe('2001:db8:abcd::x')
    expect(maskIp('unknown')).toBe('x')
    expect(maskIp('')).toBe('')
  })
})

describe('securityEvent', () => {
  it('evt=security と type を持つ1行の JSON。IP は伏せる', () => {
    const lines = capture()
    securityEvent('login_failed', { ip: '198.51.100.7', shop: 'ABCDEF' })
    expect(lines).toEqual([{ evt: 'security', type: 'login_failed', ip: '198.51.100.x', shop: 'ABCDEF' }])
  })

  it('許した項目以外（トークン・PIN・本文・ヘッダ）は書かない', () => {
    const lines = capture()
    securityEvent('perm_denied', {
      shop: 'ABCDEF', missing: ['money'], token: 'secret-token', pin: '1234', body: { pin: '1234' },
      authorization: 'Bearer x', headers: { a: 1 },
    })
    const s = JSON.stringify(lines)
    for (const leak of ['secret-token', '1234', 'Bearer', 'authorization', 'headers']) expect(s).not.toContain(leak)
    expect(lines[0].missing).toEqual(['money'])
  })
})
