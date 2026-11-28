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

describe('handleConfigPut: 棚卸の導線（2026-10-30）', () => {
  const R = { axisGroupsR: ['冷蔵庫'], tagsR: { トマト: ['冷蔵庫'] }, axisItemOrderR: ['トマト'], tagsArchiveR: {}, routeMore: [] }
  it('導線を知らない端末の保存では、前の導線を引き継ぐ', async () => {
    const db = fakeDb({ order: ['トマト'], images: {}, ...R })
    await handleConfigPut(db, 'ABCD', { order: ['トマト'], images: {} })
    expect(db.saved.axisGroupsR).toEqual(['冷蔵庫'])
    expect(db.saved.tagsR).toEqual({ トマト: ['冷蔵庫'] })
  })
  it('導線を送った保存はその値で上書きする', async () => {
    const db = fakeDb({ order: ['トマト'], images: {}, ...R })
    await handleConfigPut(db, 'ABCD', { order: ['トマト'], images: {}, axisGroupsR: [], tagsR: {} })
    expect(db.saved.axisGroupsR).toEqual([])
  })
})

describe('handleConfigPut: 品目の ID（ITEM-001）', () => {
  const A = 'it_00000000000000aa', B = 'it_00000000000000bb'
  it('ID を知らない古い端末の保存では、前の ID を残す', async () => {
    const db = fakeDb({ order: ['トマト'], itemIds: { トマト: A } })
    await handleConfigPut(db, 'ABCD', { order: ['トマト', 'レタス'] })
    expect(db.saved.itemIds).toEqual({ トマト: A })
  })
  it('知っている端末の保存は前の ID に重ねる（消した品目の ID は残る）', async () => {
    const db = fakeDb({ order: ['トマト', '塩'], itemIds: { トマト: A, 塩: B } })
    await handleConfigPut(db, 'ABCD', { order: ['トマト'], itemIds: { トマト: A } })
    expect(db.saved.itemIds).toEqual({ トマト: A, 塩: B })
  })
  it('名前を変えて ID が移ったら、古い名前の対応は落とす', async () => {
    const db = fakeDb({ order: ['トマト'], itemIds: { トマト: A } })
    await handleConfigPut(db, 'ABCD', { order: ['ミニトマト'], itemIds: { ミニトマト: A } })
    expect(db.saved.itemIds).toEqual({ ミニトマト: A })
  })
})

describe('handleConfigPut: 統合の付け替え（ITEM-001 I-5）', () => {
  const AL = { it_00000000000000bb: 'it_00000000000000aa' }
  it('知らない古い端末の保存では前の付け替えを残す', async () => {
    const db = fakeDb({ order: ['トマト'], itemAliases: AL, notDuplicates: ['a|b'] })
    await handleConfigPut(db, 'ABCD', { order: ['トマト'] })
    expect(db.saved.itemAliases).toEqual(AL)
    expect(db.saved.notDuplicates).toEqual(['a|b'])
  })
  it('知っている端末の値が正（元に戻すで空になったら空）', async () => {
    const db = fakeDb({ order: ['トマト'], itemAliases: AL })
    await handleConfigPut(db, 'ABCD', { order: ['トマト', 'とまと'], itemAliases: {} })
    expect(db.saved.itemAliases).toEqual({})
  })
})
