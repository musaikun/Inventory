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
      replenishTargets: { トマト: 12 },
      orderSchedules: [{ id: 'a', name: '青果', days: [2, 5], deadline: '15:00' }],
      isCustom: true,
    }
    const out = normalizeConfig(src)
    expect(out.reorderPoints).toEqual({ トマト: 5 })
    // 補充目標と発注スケジュールもホスト→ゲストへ中継する（列挙漏れ＝事故B-01の再発防止）
    expect(out.replenishTargets).toEqual({ トマト: 12 })
    expect(out.orderSchedules).toEqual([{ id: 'a', name: '青果', days: [2, 5], deadline: '15:00' }])
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
    expect(out.replenishTargets).toEqual({})
    expect(out.orderSchedules).toEqual([])
    expect(out.tagsA).toEqual({})
    expect(out.axisGroupsA).toEqual([])
    expect(out.hiddenItems).toEqual([])
    expect(out.isCustom).toBe(false)
  })

  it('order が配列でなければ空配列に正規化', () => {
    expect(normalizeConfig({}).order).toEqual([])
  })

  // R3-01: 発注スケジュールが DO 中継で脱落しないこと（B-01 再発防止）
  it('orderSchedules の days/deadline/name を正規化する', () => {
    const out = normalizeConfig({
      order: ['トマト'],
      orderSchedules: [
        { id: 's1', name: '  青果  ', days: [5, 1, 3, 3, 9, -1, 'x'], deadline: '15:00' },
        { id: 's2', name: 'あ'.repeat(30), days: [0], deadline: 'あ' },
      ],
    })
    expect(out.orderSchedules).toEqual([
      { id: 's1', name: '青果', days: [1, 3, 5], deadline: '15:00' },
      { id: 's2', name: 'あ'.repeat(20), days: [0], deadline: '' },
    ])
  })

  it('曜日が空の行は捨て、上限5件で切り捨てる', () => {
    const out = normalizeConfig({
      order: ['A'],
      orderSchedules: [
        { name: 'A', days: [1] }, { name: '空', days: [] }, { name: 'B', days: [2] },
        { name: 'C', days: [3] }, { name: 'D', days: [4] }, { name: 'E', days: [5] },
        { name: 'F', days: [6] },
      ],
    })
    expect(out.orderSchedules.map(s => s.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    // id が無い行にも表示キー用の id を必ず振る
    expect(out.orderSchedules.every(s => typeof s.id === 'string' && s.id)).toBe(true)
  })

  // 旧clientが送る単一形式も落とさない（version混在中のゲストを壊さない）
  it('旧・単一形式 orderSchedule は1件へ移行する', () => {
    const out = normalizeConfig({ order: ['A'], orderSchedule: { days: [3, 6], deadline: '10:30' } })
    expect(out.orderSchedules).toHaveLength(1)
    expect(out.orderSchedules[0].days).toEqual([3, 6])
    expect(out.orderSchedules[0].deadline).toBe('10:30')
  })

  it('orderSchedules 欠損・不正は空配列に落とす', () => {
    expect(normalizeConfig({ order: ['A'] }).orderSchedules).toEqual([])
    expect(normalizeConfig({ order: ['A'], orderSchedules: 'nope' }).orderSchedules).toEqual([])
    expect(normalizeConfig({ order: ['A'], orderSchedule: { days: 'nope', deadline: 'あ' } }).orderSchedules)
      .toEqual([])
  })
})
