import { describe, it, expect } from 'vitest'
import { isEntered, safeDelta, detectAnomalies } from './analysisQuality.js'

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
