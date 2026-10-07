import { describe, expect, it } from 'vitest'
import { handleCron } from './pushHandler.js'

function createCronDb() {
  const statements = []
  function prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    const stmt = {
      bind() { return stmt },
      async run() {
        statements.push(normalized)
        return { success: true, meta: { changes: 0 } }
      },
    }
    return stmt
  }
  async function batch(items) {
    return Promise.all(items.map(item => item.run()))
  }
  return { prepare, batch, statements }
}

describe('handleCron security retention', () => {
  it('VAPID未設定でもaccount deletionとsecurity recordをcleanupする', async () => {
    const db = createCronDb()

    await handleCron({ DB: db })

    expect(db.statements.some(sql => sql.startsWith('DELETE FROM account_deletion_receipts'))).toBe(true)
    expect(db.statements.some(sql => sql.startsWith('DELETE FROM stores'))).toBe(true)
    expect(db.statements).toContain('DELETE FROM login_attempts WHERE attempted_at <= ?')
    expect(db.statements).toContain('DELETE FROM ip_attempts WHERE attempted_at <= ?')
    // スタッフの記録（暗証番号の失敗・招待・開いていた記録）も同じ cron で消す
    expect(db.statements).toContain('DELETE FROM staff_login_attempts WHERE attempted_at <= ?')
    expect(db.statements).toContain('DELETE FROM staff_invites WHERE expires_at <= ?')
    expect(db.statements).toContain('DELETE FROM work_sessions WHERE last_seen_at < ?')
  })
})
