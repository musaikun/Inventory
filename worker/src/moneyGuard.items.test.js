// 単価を見られない人の config に、品目ごとのまとまり（items）の単価を渡さない（ITEM-001 I-4b）
import { describe, it, expect } from 'vitest'
import { stripConfigMoney, restoreConfigMoney } from './moneyGuard.js'

const items = { it_00000000000000aa: { name: 'トマト', unit: '個', price: 120 } }

describe('moneyGuard と items', () => {
  it('応答: 単価の表もまとまりも落とす', () => {
    const out = stripConfigMoney({ order: ['トマト'], prices: { トマト: 120 }, items })
    expect(out.prices).toEqual({})
    expect('items' in out).toBe(false)
    expect(JSON.stringify(out)).not.toContain('120')
  })
  it('保存: 単価は前の値に戻し、単価の無いまとまりは保存しない', () => {
    const out = restoreConfigMoney({ prices: { トマト: 120 }, items }, { order: ['トマト'], prices: {}, items: { it_00000000000000aa: { name: 'トマト' } } })
    expect(out.prices).toEqual({ トマト: 120 })
    expect('items' in out).toBe(false)
  })
})
