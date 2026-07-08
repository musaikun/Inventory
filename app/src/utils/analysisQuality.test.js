import { describe, it, expect } from 'vitest'
import { isEntered, safeDelta, detectAnomalies, snapshotConfidence } from './analysisQuality.js'

const item = (name, qty, unit = '袋') => ({ item: name, qty, unit })

describe('isEntered', () => {
  it('null/undefined は未入力', () => {
    expect(isEntered(item('a', null))).toBe(false)
    expect(isEntered(item('a', undefined))).toBe(false)
  })
  it('0 は入力済み（在庫ゼロ）', () => {
    expect(isEntered(item('a', 0))).toBe(true)
  })
})

describe('safeDelta', () => {
  it('未入力があれば比較不能', () => {
    expect(safeDelta(item('a', 5), item('a', null)).comparable).toBe(false)
  })
  it('減少を使用として検出', () => {
    const d = safeDelta(item('a', 38), item('a', 65))
    expect(d.comparable).toBe(true)
    expect(d.delta).toBe(-27)
    expect(d.direction).toBe('decrease')
  })
  it('単位変更を検出', () => {
    expect(safeDelta(item('a', 5, '個'), item('a', 5, '袋')).unitChanged).toBe(true)
  })
})

describe('detectAnomalies', () => {
  it('納品なし前提で在庫増を異常フラグ', () => {
    const cur  = { items: [item('パスタ', 65)] }
    const prev = { items: [item('パスタ', 40)] }
    const f = detectAnomalies(cur, prev)
    expect(f.some(x => x.type === 'unexpected_increase')).toBe(true)
  })
  it('桁違いの比を異常フラグ', () => {
    const cur  = { items: [item('油', 200)] }
    const prev = { items: [item('油', 2)] }
    const f = detectAnomalies(cur, prev, { deliveryExpected: true })
    expect(f.some(x => x.type === 'extreme_ratio')).toBe(true)
  })
  it('単位変更をフラグ', () => {
    const cur  = { items: [item('塩', 3, '個')] }
    const prev = { items: [item('塩', 5, '袋')] }
    const f = detectAnomalies(cur, prev, { deliveryExpected: true })
    expect(f.some(x => x.type === 'unit_changed')).toBe(true)
  })
})

describe('snapshotConfidence（シビア）', () => {
  it('完全入力・多件数・新しい → 高', () => {
    const items = Array.from({ length: 40 }, (_, i) => item('i' + i, 1))
    const r = snapshotConfidence({ items, savedAt: new Date().toISOString() })
    expect(r.label).toBe('高')
    expect(r.score).toBeGreaterThanOrEqual(90)
  })
  it('半分未入力なら大きく減点', () => {
    const items = Array.from({ length: 40 }, (_, i) => item('i' + i, i < 20 ? 1 : null))
    const r = snapshotConfidence({ items, savedAt: new Date().toISOString() })
    expect(r.completeness).toBe(50)
    expect(r.score).toBeLessThanOrEqual(50)
  })
  it('件数が少なければ即キャップ', () => {
    const items = Array.from({ length: 3 }, (_, i) => item('i' + i, 1))
    const r = snapshotConfidence({ items, savedAt: new Date().toISOString() })
    expect(r.score).toBeLessThanOrEqual(20)
    expect(r.label).toBe('不足')
  })
})
