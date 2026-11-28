// 設定の品目ごとのまとまり（ITEM-001 I-4b）
import { describe, it, expect } from 'vitest'
import { toConfigItems, expandConfigItems } from './configItems.js'

const cfg = {
  order: ['トマト', '塩'],
  itemIds: { トマト: 'it_00000000000000aa', 塩: 'it_00000000000000bb', 消した: 'it_00000000000000cc' },
  units: { トマト: '個', 塩: '袋' }, prices: { トマト: 120 }, categories: { トマト: '野菜' }, codes: {}, lotSizes: {},
  images: {}, prevMonths: {}, reorderPoints: { 塩: 2 }, replenishTargets: {}, itemAdded: {}, hiddenAt: { 塩: '2026-11-01T00:00:00Z' },
  tagsA: { トマト: ['冷蔵'] }, tagsB: {}, tagsR: {},
  hiddenItems: ['塩'], hiddenAuto: [], manualItems: ['トマト'], routeMore: [],
}

describe('configItems', () => {
  it('表 → まとまり: ID がキー、並びは order の順、消した品目は入らない', () => {
    const items = toConfigItems(cfg)
    expect(Object.keys(items)).toEqual(['it_00000000000000aa', 'it_00000000000000bb'])
    expect(items.it_00000000000000aa).toEqual({ name: 'トマト', unit: '個', price: 120, category: '野菜', tagsA: ['冷蔵'], manual: true })
    expect(items.it_00000000000000bb).toEqual({ name: '塩', unit: '袋', reorderPoint: 2, hiddenAt: '2026-11-01T00:00:00Z', hidden: true })
  })

  it('まとまりだけの設定から表を組み立てられる（往復で同じ）', () => {
    const items = toConfigItems(cfg)
    const back = expandConfigItems({ items })
    expect(back.order).toEqual(['トマト', '塩'])
    expect(back.itemIds).toEqual({ トマト: 'it_00000000000000aa', 塩: 'it_00000000000000bb' })
    expect(back.units).toEqual({ トマト: '個', 塩: '袋' })
    expect(back.prices).toEqual({ トマト: 120 })
    expect(back.reorderPoints).toEqual({ 塩: 2 })
    expect(back.hiddenItems).toEqual(['塩'])
    expect(back.manualItems).toEqual(['トマト'])
    expect(back.tagsA).toEqual({ トマト: ['冷蔵'] })
  })

  it('表がある項目は表を正にする（まとまりで上書きしない）', () => {
    const items = toConfigItems(cfg)
    const back = expandConfigItems({ ...cfg, prices: { トマト: 999 }, items })
    expect(back.prices).toEqual({ トマト: 999 })
    expect(back).toBe(back)   // 揃っていればそのまま
    const same = { ...cfg, items }
    expect(expandConfigItems(same)).toBe(same)
  })
})
