import { describe, it, expect } from 'vitest'
import {
  parseDeliveryImportCSV,
  isDeliveryImportCSV,
  normalizeDate,
  normalizeType,
  deliveryImportTemplateCSV,
} from './deliveryImportParser.js'

describe('normalizeDate', () => {
  it('各種区切りを YYYY-MM-DD に正規化', () => {
    expect(normalizeDate('2026-06-01')).toBe('2026-06-01')
    expect(normalizeDate('2026/6/1')).toBe('2026-06-01')
    expect(normalizeDate('2026.6.1')).toBe('2026-06-01')
    expect(normalizeDate('2026年6月1日')).toBe('2026-06-01')
  })
  it('不正な日付は空文字', () => {
    expect(normalizeDate('')).toBe('')
    expect(normalizeDate('2026-13-01')).toBe('')
    expect(normalizeDate('6/1')).toBe('')
    expect(normalizeDate('あす')).toBe('')
  })
})

describe('normalizeType', () => {
  it('出庫系は out、それ以外は in', () => {
    expect(normalizeType('入庫')).toBe('in')
    expect(normalizeType('納品')).toBe('in')
    expect(normalizeType('')).toBe('in')
    expect(normalizeType('出庫')).toBe('out')
    expect(normalizeType('廃棄')).toBe('out')
  })
})

describe('isDeliveryImportCSV', () => {
  it('日付・品目名・数量があれば true', () => {
    expect(isDeliveryImportCSV('日付,品目名,数量\n2026-06-01,玉ねぎ,3')).toBe(true)
  })
  it('必須列が欠ければ false', () => {
    expect(isDeliveryImportCSV('品目名,数量\n玉ねぎ,3')).toBe(false)
    expect(isDeliveryImportCSV('')).toBe(false)
  })
})

describe('parseDeliveryImportCSV', () => {
  it('中間フォーマットを正規化行に変換', () => {
    const csv = [
      '日付,種別,仕入先,カテゴリ,品目名,数量,単位,単価,商品コード,入数',
      '2026/6/1,入庫,八百屋青果,野菜,玉ねぎ,20,kg,190,A001,10',
      '2026-06-03,,肉のヤマ,肉,鶏もも,5,kg,,,1',
    ].join('\n')
    const { rows, skipped, total } = parseDeliveryImportCSV(csv)
    expect(total).toBe(2)
    expect(skipped).toBe(0)
    expect(rows[0]).toEqual({
      date: '2026-06-01', type: 'in', supplier: '八百屋青果', category: '野菜',
      name: '玉ねぎ', qty: 20, unit: 'kg', price: 190, code: 'A001', lotSize: '10',
    })
    // 種別空 → in、単価空 → null
    expect(rows[1]).toMatchObject({ date: '2026-06-03', type: 'in', name: '鶏もも', qty: 5, price: null })
  })

  it('列順が違っても・表記ゆれヘッダでも読める', () => {
    const csv = [
      '商品名,納品日,入荷数,業者',
      '玉ねぎ,2026/6/1,20,八百屋',
    ].join('\n')
    const { rows } = parseDeliveryImportCSV(csv)
    expect(rows[0]).toMatchObject({ name: '玉ねぎ', date: '2026-06-01', qty: 20, supplier: '八百屋', type: 'in' })
  })

  it('数量に桁区切りカンマがあっても読める', () => {
    const csv = '日付,品目名,数量\n2026-06-01,米,"1,200"'
    expect(parseDeliveryImportCSV(csv).rows[0].qty).toBe(1200)
  })

  it('日付・数量が不正な行は skipped に数え、合計行は無視', () => {
    const csv = [
      '日付,品目名,数量',
      '2026-06-01,玉ねぎ,20',
      ',レタス,3',          // 日付なし → skip
      '2026-06-02,トマト,',  // 数量なし → skip
      '2026-06-02,ねぎ,-5',  // 0以下 → skip
      ',【合計】,',           // 合計行 → 無視（total に数えない）
    ].join('\n')
    const { rows, skipped, total } = parseDeliveryImportCSV(csv)
    expect(rows).toHaveLength(1)
    expect(skipped).toBe(3)
    expect(total).toBe(4)
  })

  it('必須列が無ければ throw', () => {
    expect(() => parseDeliveryImportCSV('品目名,数量\n玉ねぎ,3')).toThrow(/日付/)
  })

  it('有効行が0なら throw', () => {
    expect(() => parseDeliveryImportCSV('日付,品目名,数量\n,,')).toThrow(/見つかりません/)
  })

  it('テンプレCSVは自身のパーサで往復できる', () => {
    const { rows } = parseDeliveryImportCSV(deliveryImportTemplateCSV())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ name: '玉ねぎ', type: 'in', qty: 20 })
  })
})
