import { describe, it, expect, beforeEach } from 'vitest'
import { clientIp, isIpBlocked, recordIpFail } from './rateLimiter.js'
import { IP_MAX_FAILS } from './constants.js'

function createMockD1() {
  const rows = []
  function prepare(sql) {
    let bound = []
    const s = sql.replace(/\s+/g, ' ').trim()
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async first() {
        if (s.startsWith('SELECT COUNT(*) AS n FROM ip_attempts')) {
          const [ip, kind, since] = bound
          return { n: rows.filter(r => r.ip === ip && r.kind === kind && r.attempted_at > since).length }
        }
        throw new Error('Unhandled: ' + s)
      },
      async run() {
        if (s.startsWith('INSERT INTO ip_attempts')) {
          rows.push({ ip: bound[0], kind: bound[1], attempted_at: bound[2] })
          return { success: true }
        }
        if (s.startsWith('DELETE FROM ip_attempts')) {
          const [ip, kind, before] = bound
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i]
            if (r.ip === ip && r.kind === kind && r.attempted_at <= before) rows.splice(i, 1)
          }
          return { success: true }
        }
        throw new Error('Unhandled: ' + s)
      },
    }
    return stmt
  }
  return { prepare, _rows: rows }
}

describe('clientIp', () => {
  it('CF-Connecting-IP ヘッダーを返す', () => {
    const req = { headers: { get: h => h === 'CF-Connecting-IP' ? '203.0.113.7' : null } }
    expect(clientIp(req)).toBe('203.0.113.7')
  })

  it('ヘッダーが無ければ unknown', () => {
    const req = { headers: { get: () => null } }
    expect(clientIp(req)).toBe('unknown')
  })
})

describe('isIpBlocked / recordIpFail', () => {
  let db
  beforeEach(() => { db = createMockD1() })

  it('失敗が上限未満ならブロックしない', async () => {
    for (let i = 0; i < IP_MAX_FAILS - 1; i++) await recordIpFail(db, '1.2.3.4', 'probe')
    expect(await isIpBlocked(db, '1.2.3.4', 'probe')).toBe(false)
  })

  it('失敗が上限に達したらブロックする', async () => {
    for (let i = 0; i < IP_MAX_FAILS; i++) await recordIpFail(db, '1.2.3.4', 'probe')
    expect(await isIpBlocked(db, '1.2.3.4', 'probe')).toBe(true)
  })

  it('IP が違えばブロックされない', async () => {
    for (let i = 0; i < IP_MAX_FAILS; i++) await recordIpFail(db, '1.2.3.4', 'probe')
    expect(await isIpBlocked(db, '5.6.7.8', 'probe')).toBe(false)
  })

  it('kind が違えばカウントは独立', async () => {
    for (let i = 0; i < IP_MAX_FAILS; i++) await recordIpFail(db, '1.2.3.4', 'login')
    expect(await isIpBlocked(db, '1.2.3.4', 'probe')).toBe(false)
    expect(await isIpBlocked(db, '1.2.3.4', 'login')).toBe(true)
  })

  it('recordIpFail は窓の外の古い行を掃除する', async () => {
    db._rows.push({ ip: '1.2.3.4', kind: 'probe', attempted_at: '2000-01-01T00:00:00.000Z' })
    await recordIpFail(db, '1.2.3.4', 'probe')
    expect(db._rows.filter(r => r.attempted_at.startsWith('2000'))).toHaveLength(0)
  })
})
