import { describe, it, expect } from 'vitest'
import { normalizeConfig } from './RoomDO.js'

describe('normalizeConfig（config中継の全フィールド保持）', () => {
  it('軸・非表示を含む全フィールドを保持する', () => {
    const src = {
      type: 'config',
      order: ['トマト'],
      units: { トマト: '個' },
      axisNames: ['場所', '仕入先'],
      tagsA: { トマト: ['冷蔵'] },
      tagsB: { トマト: ['八百屋'] },
      axisGroupsA: ['冷蔵', '常温'],
      axisGroupsB: ['八百屋'],
      hiddenItems: ['レタス'],
      isCustom: true,
    }
    const out = normalizeConfig(src)
    expect(out.axisNames).toEqual(['場所', '仕入先'])
    expect(out.tagsA).toEqual({ トマト: ['冷蔵'] })
    expect(out.tagsB).toEqual({ トマト: ['八百屋'] })
    expect(out.axisGroupsA).toEqual(['冷蔵', '常温'])
    expect(out.axisGroupsB).toEqual(['八百屋'])
    expect(out.hiddenItems).toEqual(['レタス'])
    expect(out.order).toEqual(['トマト'])
    expect(out.isCustom).toBe(true)
  })

  it('欠損フィールドは安全な既定値になる', () => {
    const out = normalizeConfig({ order: ['A'] })
    expect(out.axisNames).toEqual(['', ''])
    expect(out.tagsA).toEqual({})
    expect(out.axisGroupsA).toEqual([])
    expect(out.hiddenItems).toEqual([])
    expect(out.isCustom).toBe(false)
  })

  it('order が配列でなければ空配列に正規化', () => {
    expect(normalizeConfig({}).order).toEqual([])
  })
})
