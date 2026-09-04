// 列指定で組み直した中間CSVが、既存の取込パーサの契約を満たすことの回帰。
// ここが崩れると「画面で選んだ列」と「取り込まれた値」がずれる。
import { describe, it, expect } from 'vitest'
import { buildMappedCSV, detectColumn, STOCKTAKE_FIELDS, DELIVERY_FIELDS } from './rowMapping.js'
import { tokenizeCSV } from './csvParse.js'
import { parseResultSnapshots } from './resultCsvParser.js'
import { parseDeliveryImportCSV } from './deliveryImportParser.js'

const recordsOf = (csv) => tokenizeCSV(csv).rows

describe('detectColumn', () => {
  it('列名に含まれる語で当てる', () => {
    expect(detectColumn(['伝票日付', '商品名称', '数量'], ['日付', 'date'])).toBe(0)
    expect(detectColumn(['伝票日付', '商品名称', '数量'], ['品名', '名称'])).toBe(1)
  })
  it('実物の帳票の半角カナ見出しに当てる（商品ｺｰﾄﾞ）', () => {
    // PRONTO の棚卸記入表は見出しが半角カナ。字形をそろえずに比べていたため、
    // コード列だけが自動検出から漏れて手作業になっていた。
    const head = ['商品ｺｰﾄﾞ', '商品名', '単位', '入数', '前月実績']
    expect(detectColumn(head, ['商品コード', 'コード'])).toBe(0)
    expect(detectColumn(head, ['入数', 'ロット'])).toBe(3)
  })
  it('当たらなければ null（推測で埋めない）', () => {
    expect(detectColumn(['A', 'B'], ['日付'])).toBeNull()
    expect(detectColumn(null, ['日付'])).toBeNull()
  })
})

describe('buildMappedCSV', () => {
  const fields = [
    { key: 'date', header: '日付' },
    { key: 'name', header: '品目名' },
    { key: 'qty',  header: '数量' },
  ]

  it('選んだ列だけを正規のヘッダ名で出す', () => {
    const csv = 'メモ,いつ,なに,いくつ\nx,2026-06-01,トマト,3'
    const out = buildMappedCSV(recordsOf(csv), { date: 1, name: 2, qty: 3 }, fields, true)
    expect(out).toBe('日付,品目名,数量\n2026-06-01,トマト,3')
  })

  it('見出し無しを選べば1行目も残る', () => {
    const csv = '2026-06-01,トマト,3\n2026-06-01,レタス,2'
    const out = buildMappedCSV(recordsOf(csv), { date: 0, name: 1, qty: 2 }, fields, false)
    expect(out.split('\n')).toHaveLength(3)   // ヘッダ + 2行
    expect(out).toContain('トマト')
  })

  it('未指定の項目は列ごと出さない', () => {
    const csv = '2026-06-01,トマト,3'
    const out = buildMappedCSV(recordsOf(csv), { date: 0, name: 1, qty: null }, fields, false)
    expect(out.split('\n')[0]).toBe('日付,品目名')
  })

  it('カンマ・引用符を含む値を壊さない', () => {
    const csv = '2026-06-01,"トマト,大玉",3\n2026-06-01,"5"" 皿",1'
    const out = buildMappedCSV(recordsOf(csv), { date: 0, name: 1, qty: 2 }, fields, false)
    const back = tokenizeCSV(out).rows
    expect(back[1].cols[1]).toBe('トマト,大玉')
    expect(back[2].cols[1]).toBe('5" 皿')
  })

  it('全項目が空の行は出さない', () => {
    const csv = '2026-06-01,トマト,3\n,,\n2026-06-02,レタス,1'
    const out = buildMappedCSV(recordsOf(csv), { date: 0, name: 1, qty: 2 }, fields, false)
    expect(out.split('\n')).toHaveLength(3)
  })
})

// 組み直したCSVは、既存パーサがそのまま読めなければ意味がない。
describe('既存の取込パーサへ渡せる', () => {
  it('過去棚卸: 日付ごとのスナップショットになる', () => {
    const csv = '伝票日付,商品名称,在庫数,原価\n2026/6/1,トマト,3,120\n2026/6/1,レタス,2,80\n2026/6/8,トマト,1,120'
    const records = recordsOf(csv)
    const mapping = { date: 0, name: 1, qty: 2, price: 3 }
    const out = buildMappedCSV(records, mapping, STOCKTAKE_FIELDS, true)

    const { snapshots, errors } = parseResultSnapshots(out)
    expect(errors).toEqual([])
    expect(snapshots.map(s => s.date)).toEqual(['2026-06-01', '2026-06-08'])
    expect(snapshots[0].items).toHaveLength(2)
    expect(snapshots[0].items[0]).toMatchObject({ item: 'トマト', qty: 3, unitPrice: 120 })
  })

  it('過去納品: 入庫行として読める', () => {
    const csv = '納品日,取引先,品名,数,仕入単価\n2026-06-01,青果A,トマト,10,120'
    const mapping = { date: 0, supplier: 1, name: 2, qty: 3, price: 4 }
    const out = buildMappedCSV(recordsOf(csv), mapping, DELIVERY_FIELDS, true)

    const { rows, errors } = parseDeliveryImportCSV(out)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-06-01', name: 'トマト', qty: 10, price: 120, supplier: '青果A', type: 'in' })
  })
})
