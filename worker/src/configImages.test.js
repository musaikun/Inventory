// 写真（images）を知らない古い端末の保存で、D1 の写真の割り当てを消さない
import { describe, it, expect } from 'vitest'
import { handleConfigPut } from './storeHandler.js'

function fakeDb(initial) {
  let row = initial ? { config_json: JSON.stringify(initial) } : null
  return {
    get saved() { return row && JSON.parse(row.config_json) },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return sql.includes('SELECT config_json') ? row : null },
            async run() { if (sql.includes('INSERT INTO store_configs')) row = { config_json: args[1] }; return {} },
          }
        },
      }
    },
  }
}
const IMG = { トマト: 'ABCD/' + 'a'.repeat(32) }

describe('handleConfigPut: 写真の割り当て', () => {
  it('images キーが無い保存では、前の写真を引き継ぐ', async () => {
    const db = fakeDb({ order: ['トマト'], images: IMG })
    await handleConfigPut(db, 'ABCD', { order: ['トマト', 'レタス'] })
    expect(db.saved.images).toEqual(IMG)
    expect(db.saved.order).toEqual(['トマト', 'レタス'])
  })
  it('images を送った保存（外した・空）はその値で上書きする', async () => {
    const db = fakeDb({ order: ['トマト'], images: IMG })
    await handleConfigPut(db, 'ABCD', { order: ['トマト'], images: {} })
    expect(db.saved.images).toEqual({})
  })
})
