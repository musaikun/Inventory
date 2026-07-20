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
      reorderPoints: { トマト: 5 },
      isCustom: true,
    }
    const out = normalizeConfig(src)
    expect(out.reorderPoints).toEqual({ トマト: 5 })
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
    expect(out.reorderPoints).toEqual({})
    expect(out.tagsA).toEqual({})
    expect(out.axisGroupsA).toEqual([])
    expect(out.hiddenItems).toEqual([])
    expect(out.isCustom).toBe(false)
  })

  it('order が配列でなければ空配列に正規化', () => {
    expect(normalizeConfig({}).order).toEqual([])
  })

  // R3-01: orderSchedule が DO 中継で脱落しないこと（B-01 再発防止）
  it('orderSchedule を保持し、days/deadline を正規化する', () => {
    const out = normalizeConfig({
      order: ['トマト'],
      orderSchedule: { days: [1, 3, 3, 5, 9, -1, 'x'], deadline: '15:00' },
    })
    expect(out.orderSchedule).toEqual({ days: [1, 3, 5], deadline: '15:00' })
  })

  it('orderSchedule 欠損・不正 deadline は空の既定に落とす', () => {
    expect(normalizeConfig({ order: ['A'] }).orderSchedule).toEqual({ days: [], deadline: '' })
    expect(normalizeConfig({ order: ['A'], orderSchedule: { days: 'nope', deadline: 'あ' } }).orderSchedule)
      .toEqual({ days: [], deadline: '' })
  })
})
