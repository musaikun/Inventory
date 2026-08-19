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

  it('空欄は skipped、書いてあるのに読めない値は errors。合計行は無視', () => {
    const csv = [
      '日付,品目名,数量',
      '2026-06-01,玉ねぎ,20',
      ',レタス,3',          // 日付が空 → skipped（未入力）
      '2026-06-02,トマト,',  // 数量が空 → skipped（未入力）
      '2026-06-02,ねぎ,-5',  // 0以下 → errors（書いてあるが取り込めない）
      ',【合計】,',           // 合計行 → 無視（total に数えない）
    ].join('\n')
    const { rows, skipped, total, errors } = parseDeliveryImportCSV(csv)
    expect(rows).toHaveLength(1)
    expect(skipped).toBe(2)
    expect(total).toBe(4)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ line: 5, columnLabel: '数量', value: '-5', name: 'ねぎ' })
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

describe('数値の解釈 — 品目取込・棚卸結果取込と同じ契約', () => {
  const csv = (...lines) => ['日付,品目名,数量,単価', ...lines].join('\n')

  it('12abc / 1,20 / -100 / abc100 を黙って正常値へ変換せず errors に入れる', () => {
    // 桁区切りに見える不正値はセルが割れないよう引用符で囲んで渡す
    for (const bad of ['12abc', '1,20', '-100', 'abc100', 'NaN', 'Infinity']) {
      const cell = bad.includes(',') ? `"${bad}"` : bad
      const { rows, errors } = parseDeliveryImportCSV(csv(`2026-06-01,玉ねぎ,${cell},190`))
      expect(rows, bad).toHaveLength(0)
      expect(errors, bad).toHaveLength(1)
      expect(errors[0], bad).toMatchObject({ line: 2, columnLabel: '数量', value: bad, name: '玉ねぎ' })
    }
  })

  it('不正な単価も行ごとエラーにする（負単価を null にすり替えない）', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv('2026-06-01,玉ねぎ,20,-100'))
    expect(rows).toHaveLength(0)
    expect(errors[0]).toMatchObject({ columnLabel: '単価', value: '-100' })
  })

  it('正しい 1,200 と小数は受理する', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv(
      '2026-06-01,玉ねぎ,"1,200","1,500"',
      '2026-06-01,レタス,0.5,80',
    ))
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ qty: 1200, price: 1500 })
    expect(rows[1]).toMatchObject({ qty: 0.5 })
  })

  it('読めない日付は「不備でスキップ」ではなく errors に出す', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv('2026-13-45,玉ねぎ,20,190'))
    expect(rows).toHaveLength(0)
    expect(errors[0]).toMatchObject({ columnLabel: '日付', value: '2026-13-45' })
  })

  it('全行が読めなくても errors を返す（理由を消して throw しない）', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv('2026-06-01,玉ねぎ,12abc,190'))
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('テンプレCSVは引用符を含む値でも壊れない形で書き出す', () => {
    const { rows } = parseDeliveryImportCSV(deliveryImportTemplateCSV())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ name: '玉ねぎ', qty: 20, price: 190 })
  })
})

describe('実在する日付だけを受理する（月日の範囲だけ見ない）', () => {
  it('normalizeDate は閏年を判定する', () => {
    expect(normalizeDate('2024-02-29')).toBe('2024-02-29')
    expect(normalizeDate('2025-02-29')).toBe('')
    expect(normalizeDate('2026-02-30')).toBe('')
    expect(normalizeDate('2026-02-31')).toBe('')
    expect(normalizeDate('2026-04-31')).toBe('')
  })

  it('既存の / . 年月日 表記は引き続き正規化する', () => {
    expect(normalizeDate('2024/2/29')).toBe('2024-02-29')
    expect(normalizeDate('2026.6.1')).toBe('2026-06-01')
    expect(normalizeDate('2026年6月1日')).toBe('2026-06-01')
  })

  it('存在しない日は黙ってskipせず、既存形式の行エラーにする', () => {
    const csv = ['日付,品目名,数量,単価', '2026-02-30,玉ねぎ,20,190'].join('\n')
    const { rows, errors } = parseDeliveryImportCSV(csv)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ line: 2, columnLabel: '日付', value: '2026-02-30', name: '玉ねぎ' })
  })
})

describe('数量・単価の上限（Worker契約と同じ値）', () => {
  const csv = (...lines) => ['日付,品目名,数量,単価', ...lines].join('\n')

  it('上限ちょうどは受理する', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv('2026-06-01,玉ねぎ,1000000,100000000'))
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ qty: 1_000_000, price: 100_000_000 })
  })

  it('数量が上限+1なら行エラーにして取り込まない', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv('2026-06-01,玉ねぎ,1000001,190'))
    expect(rows).toHaveLength(0)
    expect(errors[0]).toMatchObject({ line: 2, columnLabel: '数量', value: '1000001', name: '玉ねぎ' })
  })

  it('単価が上限+1なら行エラーにして取り込まない', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv('2026-06-01,玉ねぎ,20,100000001'))
    expect(rows).toHaveLength(0)
    expect(errors[0]).toMatchObject({ line: 2, columnLabel: '単価', value: '100000001' })
  })
})

describe('列数がヘッダと一致しない行を正常データとして受理しない', () => {
  const csv = (...lines) => ['日付,品目名,単位,数量,単価', ...lines].join('\n')

  it('列が足りない行は、品目名まで別列へずれる前に行エラーにする', () => {
    // 修正前は 単位=1 / 数量=100 として黙って受理していた
    const { rows, errors } = parseDeliveryImportCSV(csv(
      '2026-01-01,玉ねぎ,kg,20,190',
      '2026-01-01,米,1,100',
    ))
    expect(rows.map(r => r.name)).toEqual(['玉ねぎ'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ line: 3, columnLabel: '列数', value: '4列' })
  })

  it('列が多い行も行エラーにする', () => {
    const { errors } = parseDeliveryImportCSV(csv(
      '2026-01-01,玉ねぎ,kg,20,190',
      '2026-01-01,米,袋,1,100,余分',
    ))
    expect(errors[0]).toMatchObject({ line: 3, columnLabel: '列数', value: '6列' })
  })

  it('列数が合っている既存の正常CSVは通す', () => {
    const { rows, errors } = parseDeliveryImportCSV(csv(
      '2026-01-01,玉ねぎ,kg,20,190',
      '2026-01-01,米,袋,1,100',
    ))
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
  })

  it('テンプレCSVは引き続き列数が揃っている', () => {
    const { rows, errors } = parseDeliveryImportCSV(deliveryImportTemplateCSV())
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
  })
})
