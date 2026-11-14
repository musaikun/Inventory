import { describe, it, expect, beforeEach } from 'vitest'
import { noteUnit, orderUnits } from './recentUnits.js'

const OPTS = ['袋', '本', '個', 'パック', 'kg']
beforeEach(() => localStorage.clear())

describe('recentUnits', () => {
  it('何も選んでいなければ元の順', () => {
    expect(orderUnits(OPTS)).toEqual(OPTS)
  })
  it('最近選んだ単位が先頭に来る（新しい順）。残りは元の順', () => {
    noteUnit('個'); noteUnit('kg')
    expect(orderUnits(OPTS)).toEqual(['kg', '個', '袋', '本', 'パック'])
  })
  it('同じ単位を選び直しても重複しない。空は覚えない', () => {
    noteUnit('個'); noteUnit(''); noteUnit('個')
    expect(orderUnits(OPTS)).toEqual(['個', '袋', '本', 'パック', 'kg'])
  })
  it('選択肢に無い単位（手入力）は並びに足さない', () => {
    noteUnit('ダース')
    expect(orderUnits(OPTS)).toEqual(OPTS)
  })
  it('覚えるのは4つまで', () => {
    for (const u of ['袋', '本', '個', 'パック', 'kg']) noteUnit(u)
    expect(orderUnits(OPTS)).toEqual(['kg', 'パック', '個', '本', '袋'])
  })
  it('保存が壊れていても落ちない', () => {
    localStorage.setItem('_recent_units_v1', '{bad')
    expect(orderUnits(OPTS)).toEqual(OPTS)
  })
})
