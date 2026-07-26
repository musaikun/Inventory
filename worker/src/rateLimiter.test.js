import { describe, it, expect, beforeEach } from 'vitest'
import { clientIp, isIpBlocked, recordIpFail, cleanupExpiredSecurityRecords } from './rateLimiter.js'
import { IP_MAX_FAILS, SECURITY_ATTEMPT_RETENTION_MS } from './constants.js'

function createMockD1() {
  const rows = []
  const loginRows = []
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
        if (s === 'DELETE FROM ip_attempts WHERE attempted_at <= ?') {
          const [before] = bound
          const initial = rows.length
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].attempted_at <= before) rows.splice(i, 1)
          }
          return { success: true, meta: { changes: initial - rows.length } }
        }
        if (s.startsWith('DELETE FROM ip_attempts WHERE ip')) {
          const [ip, kind, before] = bound
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i]
            if (r.ip === ip && r.kind === kind && r.attempted_at <= before) rows.splice(i, 1)
          }
          return { success: true }
        }
        if (s === 'DELETE FROM login_attempts WHERE attempted_at <= ?') {
          const [before] = bound
          const initial = loginRows.length
          for (let i = loginRows.length - 1; i >= 0; i--) {
            if (loginRows[i].attempted_at <= before) loginRows.splice(i, 1)
          }
          return { success: true, meta: { changes: initial - loginRows.length } }
        }
        throw new Error('Unhandled: ' + s)
      },
    }
    return stmt
  }
  async function batch(statements) {
    return Promise.all(statements.map(statement => statement.run()))
  }
  return { prepare, batch, _rows: rows, _loginRows: loginRows }
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

describe('cleanupExpiredSecurityRecords', () => {
  it('レート制限窓以前のlogin/IP行だけを全体cleanupする', async () => {
    const db = createMockD1()
    const now = new Date('2026-07-26T01:00:00.000Z')
    const old = new Date(now.getTime() - SECURITY_ATTEMPT_RETENTION_MS - 1).toISOString()
    const recent = new Date(now.getTime() - SECURITY_ATTEMPT_RETENTION_MS + 1).toISOString()
    db._loginRows.push(
      { shop_code: 'OLD', attempted_at: old },
      { shop_code: 'NEW', attempted_at: recent },
    )
    db._rows.push(
      { ip: '192.0.2.1', kind: 'login', attempted_at: old },
      { ip: '192.0.2.2', kind: 'login', attempted_at: recent },
    )

    const result = await cleanupExpiredSecurityRecords(db, now)

    expect(result.loginAttemptsDeleted).toBe(1)
    expect(result.ipAttemptsDeleted).toBe(1)
    expect(db._loginRows.map(row => row.shop_code)).toEqual(['NEW'])
    expect(db._rows.map(row => row.ip)).toEqual(['192.0.2.2'])
  })

  it('不正な基準時刻を拒否する', async () => {
    await expect(cleanupExpiredSecurityRecords(createMockD1(), 'invalid')).rejects.toThrow('Invalid cleanup time')
  })
})
