import { describe, it, expect } from 'vitest'
import { buildOrderExport, defaultExportAxis, exportLine } from './orderExport.js'

const config = {
  order: ['キャベツ', 'トマト缶', '牛乳', 'パスタ'],
  axisNames: ['保管場所', '仕入先'],
  tagsB: { キャベツ: ['八百屋'], 牛乳: ['乳業'], トマト缶: ['八百屋'] },
  axisGroupsB: ['乳業', '八百屋'],
  codes: { キャベツ: '1001' },
}
const order = { lines: [
  { item: '牛乳', qty: 6, unit: '本', lot: 1 },
  { item: 'パスタ', qty: 2, unit: 'kg', lot: '5kg' },
  { item: 'キャベツ', qty: 1.5, unit: '玉', lot: null },
  { item: 'トマト缶', qty: 3, unit: '缶', lot: '24缶' },
  { item: '消した', qty: 0, unit: '', lot: 1 },
] }

describe('発注の書き出し', () => {
  it('仕入先らしい並び替えを既定にする', () => {
    expect(defaultExportAxis(config.axisNames)).toBe(1)
    expect(defaultExportAxis(['保管場所', ''])).toBe(-1)
  })
  it('1行は品目名と数量＋単位。入数が2以上は口', () => {
    expect(exportLine({ item: 'トマト缶', qty: 3, unit: '缶', lot: '24缶' })).toBe('トマト缶　3口')
    expect(exportLine({ item: '牛乳', qty: 6, unit: '本', lot: 1 }, { code: 'A1' })).toBe('A1 牛乳　6本')
  })
  it('仕入先ごとに、並び替えの順・品目リストの順で分ける。振り分けなしは最後', () => {
    const g = buildOrderExport(order, config, { axis: 1 })
    expect(g.map(x => x.name)).toEqual(['乳業', '八百屋', '振り分けなし'])
    expect(g[1].text).toBe('キャベツ　1.5玉\nトマト缶　3口')
    expect(g[2].lines).toEqual(['パスタ　2口'])
  })
  it('分けないときは1つにまとめ、選べば商品コードを付ける', () => {
    const g = buildOrderExport(order, config, { axis: -1, withCode: true })
    expect(g).toHaveLength(1)
    expect(g[0].lines[0]).toBe('1001 キャベツ　1.5玉')
  })
})
