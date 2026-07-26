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
  })
})
