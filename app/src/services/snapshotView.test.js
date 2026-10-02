import { describe, it, expect } from 'vitest'
import { snapshotViewConfig, categoryOrderOf, sortByCategoryAndCode } from './snapshotView.js'

const snap = {
  items: [
    { item: 'ビール瓶', category: 'ビール', tagA: '倉庫' },
    { item: 'コーヒー豆A', category: 'コーヒー豆', tagA: '棚|倉庫' },
    { item: 'パスタ麺', category: 'パスタ' },
  ],
  axisNames: ['保管場所', ''],
}
const rank = cfg => Object.entries(cfg.categoryCodes).sort((a, b) => a[1] - b[1]).map(([c]) => c)

describe('snapshotViewConfig（閲覧の並びをホームに揃える）', () => {
  it('店舗設定があれば、ホームと同じ分類コード順', () => {
    const live = { categories: { x: 'パスタ', y: 'コーヒー豆', z: 'ビール' }, categoryCodes: { 'コーヒー豆': 1, 'パスタ': 2, 'ビール': 9 } }
    expect(rank(snapshotViewConfig(snap, { live }))).toEqual(['コーヒー豆', 'パスタ', 'ビール'])
  })
  it('スナップショットに残した並びを使う（ゲスト）', () => {
    expect(rank(snapshotViewConfig({ ...snap, categoryOrder: ['パスタ', 'ビール', 'コーヒー豆'] }))).toEqual(['パスタ', 'ビール', 'コーヒー豆'])
  })
  it('並びが無い古い記録は、品目の並びで最初に出た順（五十音順にしない）', () => {
    expect(rank(snapshotViewConfig(snap))).toEqual(['ビール', 'コーヒー豆', 'パスタ'])
  })
  it('振り分け（軸）の名前と品目の割り当てを渡す', () => {
    const cfg = snapshotViewConfig(snap)
    expect(cfg.axisNames).toEqual(['保管場所', ''])
    expect(cfg.tagsA['コーヒー豆A']).toEqual(['棚', '倉庫'])
    expect(cfg.tagsA['パスタ麺']).toBeUndefined()
  })
  it('categoryOrderOf はコードの無いジャンルを五十音順で後ろへ', () => {
    expect(categoryOrderOf({ categories: { a: '野菜', b: '肉', c: '酒' }, categoryCodes: { '酒': 1 } })).toEqual(['酒', '肉', '野菜'])
  })
})

describe('sortByCategoryAndCode（CSV・閲覧・詳細の並び）', () => {
  const categories = { 牛乳: '乳製品', バター: '乳製品', 玉ねぎ: '野菜', 人参: '野菜', 塩: undefined, チーズ: '乳製品' }
  const codes = { 牛乳: '10', バター: '9', 玉ねぎ: 'A-2', 人参: 'A-1' }

  it('ジャンル順 → コード順（数字は数として）→ コード無しは元の順', () => {
    const out = sortByCategoryAndCode(['塩', '牛乳', 'チーズ', '玉ねぎ', 'バター', '人参'],
      { categories, codes, categoryOrder: ['野菜', '乳製品'] })
    expect(out).toEqual(['人参', '玉ねぎ', 'バター', '牛乳', 'チーズ', '塩'])
  })

  it('並びに無いジャンルは見た順で後ろ', () => {
    const out = sortByCategoryAndCode(['牛乳', '玉ねぎ'], { categories, codes, categoryOrder: [] })
    expect(out).toEqual(['牛乳', '玉ねぎ'])
  })

  it('閲覧画面の order もコード順になる', () => {
    const cfg = snapshotViewConfig({ categoryOrder: ['乳製品'], items: [
      { item: '牛乳', category: '乳製品', code: '10' },
      { item: 'バター', category: '乳製品', code: '9' },
    ] })
    expect(cfg.order).toEqual(['バター', '牛乳'])
  })
})
