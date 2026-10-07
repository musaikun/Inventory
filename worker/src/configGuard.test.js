import { describe, it, expect } from 'vitest'
import { configChangePerms } from './configGuard.js'

const base = {
  order: ['トマト', '塩'], units: { トマト: '個', 塩: 'kg' }, prices: { トマト: 100 }, tagsA: { トマト: ['冷蔵庫'] },
  axisNames: ['保管場所', ''], axisGroupsA: ['冷蔵庫'], hiddenItems: [], reorderPoints: {}, orderSchedules: [],
  dictionary: {},
}
const next = patch => ({ ...structuredClone(base), ...patch })

describe('config の書き換えに要る権限', () => {
  it('同じ・新しい品目を足しただけ・辞書だけなら誰でも', () => {
    expect(configChangePerms(base, next({}))).toEqual([])
    expect(configChangePerms(base, next({ order: ['トマト', '塩', 'なす'], units: { ...base.units, なす: '本' }, prices: { ...base.prices, なす: 80 }, dictionary: { なすび: 'なす' } }))).toEqual([])
  })
  it('品目が消えたら item.admin、今の品目の単価・非表示は item.edit', () => {
    expect(configChangePerms(base, next({ order: ['トマト'] }))).toContain('item.admin')
    expect(configChangePerms(base, next({ prices: { トマト: 120 } }))).toEqual(['item.edit'])
    expect(configChangePerms(base, next({ hiddenItems: ['塩'] }))).toEqual(['item.edit'])
  })
  it('振り分け・並びは sort、発注点・発注日は orderSettings', () => {
    expect(configChangePerms(base, next({ tagsA: { トマト: ['棚'] } }))).toEqual(['sort'])
    expect(configChangePerms(base, next({ order: ['塩', 'トマト'] }))).toEqual(['sort'])
    expect(configChangePerms(base, next({ reorderPoints: { 塩: 2 } }))).toEqual(['orderSettings'])
    expect(configChangePerms(base, next({ orderSchedules: [{ id: 'a', days: [1] }] }))).toEqual(['orderSettings'])
  })
  it('既定値どうし（未設定と空）は変更に数えない', () => {
    const { orderSchedules, axisNames, ...old } = base
    expect(configChangePerms({ ...old, axisNames: undefined }, { ...old, axisNames: ['', ''], orderSchedules: [], orderAssumptions: null })).toEqual([])
  })
})
