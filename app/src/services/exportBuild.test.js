// 書き出しの中身（User決定 2026-10-17）。品目リストは取り込み直すと問いなしで同じに戻ること
import { describe, it, expect } from 'vitest'
import { buildItemRows, buildStocktakeSheets, buildOrderRows, buildMovementRows, periodRange } from './exportBuild.js'
import { sheetsToCsv } from '../utils/exportFile.js'
import { ownItemMapping, parseMappedCSV, buildImportPlan, IMPORT_MODE_MERGE } from '../utils/itemImport.js'

const config = () => ({
  order: ['キャベツ', '玉ねぎ', '豚バラ'],
  units: { キャベツ: '玉', 玉ねぎ: 'kg', 豚バラ: 'kg' },
  prices: { キャベツ: 180, 玉ねぎ: 220, 豚バラ: 1280 },
  categories: { キャベツ: '野菜', 玉ねぎ: '野菜', 豚バラ: '肉' },
  codes: { キャベツ: 'A1' }, categoryCodes: { 野菜: 10 }, prevMonths: {}, lotSizes: { 玉ねぎ: '10' },
  reorderPoints: { キャベツ: 3 }, dictionary: { きゃべ: 'キャベツ' },
  tagsA: { キャベツ: ['冷蔵'] }, tagsB: {}, axisNames: ['保管場所', '仕入先'],
  hiddenItems: ['豚バラ'], hiddenAuto: [], hiddenAt: {}, manualItems: [], deletedItems: [],
})

describe('品目リスト', () => {
  it('非表示は選んだときだけ（○の列）。金額なしは単価の列ごと外す', () => {
    const c = config()
    const rows = buildItemRows(c)
    expect(rows[0]).toEqual(['品目名', '単位', '単価', 'カテゴリ', 'エイリアス', '商品コード', '分類コード', '前月実績', '入数', '保管場所', '仕入先', '発注点'])
    expect(rows.map(r => r[0]).slice(1)).toEqual(['キャベツ', '玉ねぎ'])
    expect(rows[1]).toEqual(['キャベツ', '玉', 180, '野菜', 'きゃべ', 'A1', 10, '', '', '冷蔵', '', 3])
    const all = buildItemRows(c, { includeHidden: true, money: false })
    expect(all[0]).not.toContain('単価')
    expect(all[0].at(-1)).toBe('非表示')
    expect(all.map(r => r.at(-1)).slice(1)).toEqual(['', '', '○'])
  })

  it('書き出したものは、このアプリの形と分かり、取り込み直すと同じに戻る（非表示・発注点・並び替えも）', () => {
    const c = config()
    for (const money of [true, false]) {
      const csv = sheetsToCsv([{ name: 'x', rows: buildItemRows(c, { money, includeHidden: true }) }])
      const mapping = ownItemMapping(csv)
      expect(mapping).not.toBeNull()
      // 中身を変えたマスタへ取り込む → 元に戻る
      const changed = { ...config(), units: { キャベツ: '箱' }, reorderPoints: {}, hiddenItems: ['キャベツ'], tagsA: {} }
      const plan = buildImportPlan(parseMappedCSV(csv, mapping, { headerRow: 0, headerNamed: true }), changed, { mode: IMPORT_MODE_MERGE })
      expect(plan.units.キャベツ).toBe('玉')
      expect(plan.reorderPoints.キャベツ).toBe(3)
      expect(plan.tagsA.キャベツ).toEqual(['冷蔵'])
      expect(plan.hide).toEqual(['豚バラ'])
      expect(plan.unhide).toEqual(['キャベツ'])
      expect(plan.prices.豚バラ).toBe(1280)   // 金額なしで出しても単価は消えない
    }
  })

  it('ほかの形のファイルは、このアプリの形とみなさない', () => {
    expect(ownItemMapping('品目名,単位,単価\nキャベツ,玉,180')).toBeNull()
    expect(ownItemMapping('商品名,単位\nキャベツ,玉')).toBeNull()
  })
})

const snap = (date, items, totalValue) => ({ date, sessionId: date, items, totalValue })
describe('棚卸結果', () => {
  const s1 = snap('2026-09-30', [{ item: 'キャベツ', qty: 9, unitPrice: 180, subtotal: 1620, category: '野菜', unit: '玉' }], 1620)
  const s2 = snap('2026-10-31', [{ item: 'キャベツ', qty: 14, unitPrice: 180, subtotal: 2520, category: '野菜', unit: '玉' }, { item: '豚バラ', qty: null }], 2520)

  it('2回以上は品目×日付で1枚。数えていない品目も（非表示でなければ）空欄で出す', () => {
    const [sheet] = buildStocktakeSheets([s2, s1], config())
    expect(sheet.rows[0]).toEqual(['品目名', 'カテゴリ', '単位', '単価', '9/30', '10/31', '10/31 在庫金額'])
    expect(sheet.rows.map(r => r[0])).toEqual(['品目名', 'キャベツ', '玉ねぎ', '【合計金額】'])   // 豚バラ（非表示・未入力）は出さない
    expect(sheet.rows[1]).toEqual(['キャベツ', '野菜', '玉', 180, 9, 14, 2520])
    expect(sheet.rows[2]).toEqual(['玉ねぎ', '野菜', 'kg', 220, '', '', ''])
    expect(sheet.rows[3]).toEqual(['【合計金額】', '', '', '', 1620, 2520, 2520])
  })

  it('1回ずつ・金額なし', () => {
    const sheets = buildStocktakeSheets([s1, s2], config(), { layout: 'each', money: false })
    expect(sheets.map(s => s.name)).toEqual(['2026-09-30', '2026-10-31'])
    expect(sheets[0].rows[0]).toEqual(['日付', '商品コード', '品目名', 'カテゴリ', '単位', '入数', '前月実績', '数量'])
    // CSV は同じ見出しを1回にしてつなげる（日付の列で回が分かる）
    const csv = sheetsToCsv(sheets).split('\r\n')
    expect(csv.filter(l => l.startsWith('日付')).length).toBe(1)
  })

  it('非表示でも、その回で数えていれば出す', () => {
    const s = snap('2026-10-31', [{ item: '豚バラ', qty: 2 }], null)
    const [sheet] = buildStocktakeSheets([s], config(), { money: false })
    expect(sheet.rows.map(r => r[2])).toContain('豚バラ')
  })
})

describe('発注・入出庫の記録', () => {
  it('期間の中だけ。取り消した入出庫は出さない', () => {
    const orders = [
      { date: '2026-10-02', supplier: '青果', lines: [{ item: 'キャベツ', qty: 5, unit: '玉' }], by: '山田' },
      { date: '2026-09-28', supplier: '青果', lines: [{ item: '玉ねぎ', qty: 2 }] },
    ]
    const rows = buildOrderRows(orders, config(), { from: '2026-10-01', to: '2026-10-31' })
    expect(rows).toEqual([['日付', '業者', '品目名', '数量', '単位', '単価', '金額', '発注した人'], ['2026-10-02', '青果', 'キャベツ', 5, '玉', 180, 900, '山田']])
    const moves = [
      { date: '2026-10-03', type: 'out', note: '廃棄', lines: [{ item: '玉ねぎ', qty: 1, unit: 'kg' }] },
      { date: '2026-10-04', type: 'in', deletedAt: 'x', lines: [{ item: 'キャベツ', qty: 1 }] },
    ]
    expect(buildMovementRows(moves, config(), { money: false, from: '2026-10-01', to: '2026-10-31' }))
      .toEqual([['日付', '種別', '品目名', '数量', '単位', 'メモ', '記録した人'], ['2026-10-03', '出庫', '玉ねぎ', 1, 'kg', '廃棄', '']])
  })

  it('期間の選択肢', () => {
    const d = new Date(2026, 9, 17)
    expect(periodRange('thisMonth', d)).toEqual({ from: '2026-10-01', to: '2026-10-17' })
    expect(periodRange('lastMonth', d)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(periodRange('3months', d)).toEqual({ from: '2026-08-01', to: '2026-10-17' })
  })
})
