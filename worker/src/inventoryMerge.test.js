// 同じセッションの進行中在庫は、ブラウザごとに送られてきても品目ごとに合わせる（2026-10-30 実使用）
import { describe, it, expect } from 'vitest'
import { mergeInventoryPayload } from './storeHandler.js'

const item = (qty, updatedAt) => ({ qty, unit: '個', enteredBy: 'ホスト', updatedAt })

describe('mergeInventoryPayload', () => {
  it('別のブラウザの品目を消さずに足す', () => {
    const prev = { sessionId: 's1', inventory: { トマト: item(17, 100), にら: item(2, 110) }, savedAt: 200 }
    const next = { sessionId: 's1', inventory: { 焼そば: item(2, 300) }, savedAt: 300 }
    const m = mergeInventoryPayload(prev, next)
    expect(Object.keys(m.inventory).sort()).toEqual(['にら', 'トマト', '焼そば'].sort())
    expect(m.savedAt).toBe(300)
  })

  it('同じ品目は新しい方', () => {
    const prev = { sessionId: 's1', inventory: { トマト: item(17, 500) } }
    const next = { sessionId: 's1', inventory: { トマト: item(10, 100) } }
    expect(mergeInventoryPayload(prev, next).inventory.トマト.qty).toBe(17)
  })

  it('未入力に戻した品目は、それより古い記録から生き返らない', () => {
    const prev = { sessionId: 's1', inventory: { トマト: item(17, 100) } }
    const next = { sessionId: 's1', inventory: {}, removedAt: { トマト: 200 } }
    const m = mergeInventoryPayload(prev, next)
    expect(m.inventory.トマト).toBeUndefined()
    // 戻した後に入れ直したものは残る
    const again = mergeInventoryPayload(m, { sessionId: 's1', inventory: { トマト: item(5, 300) } })
    expect(again.inventory.トマト.qty).toBe(5)
  })

  it('別のセッションなら置き換える', () => {
    const prev = { sessionId: 's1', inventory: { トマト: item(17, 100) } }
    const next = { sessionId: 's2', inventory: {} }
    expect(mergeInventoryPayload(prev, next)).toBe(next)
  })
})
