import { describe, it, expect } from 'vitest'
import { parseGenericTable, extractRows } from './pdfTableParser.js'

// 実サンプルPDF（テキスト層あり・rotate=0）から抽出した座標を使う

describe('parseGenericTable', () => {
  it('2段組・日本語ヘッダ（品目コード/品目名/分類/単位/単価/数量）を段ごとに読む', () => {
    const items = [
      // ヘッダ y=506（左段 + 右段）
      { text: '品目コード', x: 30, y: 506 }, { text: '品目名', x: 77, y: 506 },
      { text: '分類', x: 230, y: 506 }, { text: '単位', x: 277, y: 506 },
      { text: '単価', x: 314, y: 506 }, { text: '数量', x: 354, y: 506 },
      { text: '品目コード', x: 451, y: 506 }, { text: '品目名', x: 498, y: 506 },
      { text: '分類', x: 651, y: 506 }, { text: '単位', x: 698, y: 506 },
      { text: '単価', x: 735, y: 506 }, { text: '数量', x: 775, y: 506 },
      // データ y=486
      { text: '2001', x: 30, y: 486 }, { text: '砂糖(グラニュー糖)', x: 77, y: 486 },
      { text: '食材', x: 230, y: 486 }, { text: '個', x: 277, y: 486 },
      { text: '480', x: 340, y: 486 }, { text: '40', x: 384, y: 486 },
      { text: '2013', x: 451, y: 486 }, { text: 'キッチンペーパー', x: 498, y: 486 },
      { text: '資材', x: 651, y: 486 }, { text: '本', x: 698, y: 486 },
      { text: '150', x: 761, y: 486 }, { text: '8', x: 808, y: 486 },
      // データ y=470
      { text: '2002', x: 30, y: 470 }, { text: '紅茶葉(アールグレイ)', x: 77, y: 470 },
      { text: '食材', x: 230, y: 470 }, { text: '箱', x: 277, y: 470 },
      { text: '90', x: 344, y: 470 }, { text: '40', x: 384, y: 470 },
      { text: '2014', x: 451, y: 470 }, { text: '紙コップ Lサイズ', x: 498, y: 470 },
      { text: '資材', x: 651, y: 470 }, { text: '本', x: 698, y: 470 },
      { text: '650', x: 761, y: 470 }, { text: '10', x: 805, y: 470 },
    ]
    const out = parseGenericTable(items)
    expect(out.map(p => p.name)).toEqual([
      '砂糖(グラニュー糖)', '紅茶葉(アールグレイ)', 'キッチンペーパー', '紙コップ Lサイズ',
    ])
    const sugar = out[0]
    expect(sugar).toMatchObject({ code: '2001', category: '食材', unit: '個', price: '480' })
    expect(out[2]).toMatchObject({ code: '2013', category: '資材', unit: '本', price: '150' })
  })

  it('単段・日本語ヘッダ（単価(円)など表記ゆれ）を読む', () => {
    const items = [
      { text: '品目コード', x: 60, y: 714 }, { text: '品目名', x: 122, y: 714 },
      { text: '分類', x: 320, y: 714 }, { text: '単位', x: 377, y: 714 },
      { text: '単価(円)', x: 420, y: 714 }, { text: '数量', x: 482, y: 714 },
      { text: '1001', x: 60, y: 688 }, { text: 'コーヒー豆(ブレンド)', x: 122, y: 688 },
      { text: '食材', x: 320, y: 688 }, { text: '袋', x: 377, y: 688 },
      { text: '980', x: 463, y: 688 }, { text: '40', x: 519, y: 688 },
    ]
    const out = parseGenericTable(items)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      code: '1001', name: 'コーヒー豆(ブレンド)', category: '食材', unit: '袋', price: '980',
    })
  })

  it('英語ヘッダ（Code/Item/Qty/Unit）を読む', () => {
    const items = [
      { text: 'Code', x: 214, y: 739 }, { text: 'Item', x: 253, y: 739 },
      { text: 'Qty', x: 331, y: 739 }, { text: 'Unit', x: 361, y: 739 },
      { text: 'A001', x: 214, y: 721 }, { text: 'Coffee Beans', x: 253, y: 721 },
      { text: '12', x: 331, y: 721 }, { text: 'bag', x: 361, y: 721 },
      { text: 'B015', x: 214, y: 703 }, { text: 'Milk 1L', x: 253, y: 703 },
      { text: '24', x: 331, y: 703 }, { text: 'pcs', x: 361, y: 703 },
    ]
    const out = parseGenericTable(items)
    expect(out.map(p => p.name)).toEqual(['Coffee Beans', 'Milk 1L'])
    expect(out[0]).toMatchObject({ code: 'A001', unit: 'bag' })
    expect(out[1]).toMatchObject({ code: 'B015', unit: 'pcs' })
  })

  it('ヘッダの無いフリーレイアウトは空配列（AI行き）', () => {
    const items = [
      { text: '品目一覧（仕入先提出資料）', x: 51, y: 780 },
      { text: '【飲料・コーヒー関連】', x: 51, y: 711 },
      { text: 'コーヒー豆（ブレンド）', x: 57, y: 694 }, { text: '袋', x: 334, y: 694 },
      { text: '1,200円(税抜)', x: 397, y: 694 },
      { text: '牛乳', x: 57, y: 655 }, { text: '本', x: 334, y: 655 }, { text: '220', x: 397, y: 655 },
    ]
    expect(parseGenericTable(items)).toEqual([])
  })
})

describe('extractRows（手動マッピング/プロファイル適用）', () => {
  // 見本行でユーザーがタップした列（フィールドとx）を指定して抽出する
  const columns = [
    { field: 'code', x: 60 }, { field: 'name', x: 122 },
    { field: 'category', x: 320 }, { field: 'unit', x: 377 },
    { field: 'price', x: 420 }, { field: 'qty', x: 482 },
  ]

  it('指定した列に沿って各行を抽出する', () => {
    const items = [
      // ヘッダ y=714（fromY より上なので除外される）
      { text: '品目コード', x: 60, y: 714 }, { text: '品目名', x: 122, y: 714 },
      { text: '分類', x: 320, y: 714 }, { text: '単位', x: 377, y: 714 },
      { text: '単価', x: 420, y: 714 }, { text: '数量', x: 482, y: 714 },
      // データ y=688
      { text: '1001', x: 60, y: 688 }, { text: 'コーヒー豆(ブレンド)', x: 122, y: 688 },
      { text: '食材', x: 320, y: 688 }, { text: '袋', x: 377, y: 688 },
      { text: '980', x: 463, y: 688 }, { text: '40', x: 519, y: 688 },
      // データ y=666
      { text: '1002', x: 60, y: 666 }, { text: '牛乳', x: 122, y: 666 },
      { text: '食材', x: 320, y: 666 }, { text: '本', x: 377, y: 666 },
      { text: '220', x: 463, y: 666 }, { text: '30', x: 519, y: 666 },
    ]
    const out = extractRows(items, columns, { fromY: 700 })
    expect(out.map(p => p.name)).toEqual(['コーヒー豆(ブレンド)', '牛乳'])
    expect(out[0]).toMatchObject({ code: '1001', category: '食材', unit: '袋', price: '980' })
    expect(out[1]).toMatchObject({ code: '1002', unit: '本', price: '220' })
  })

  it('fromY より上の行（見出し・ヘッダ）は除外する', () => {
    const items = [
      { text: '品目一覧', x: 60, y: 800 },
      { text: '品目コード', x: 60, y: 714 }, { text: '品目名', x: 122, y: 714 },
      { text: '1001', x: 60, y: 688 }, { text: 'コーヒー豆', x: 122, y: 688 },
      { text: '980', x: 463, y: 688 },
    ]
    const out = extractRows(items, columns, { fromY: 700 })
    expect(out.map(p => p.name)).toEqual(['コーヒー豆'])
  })

  it('name 列が無い指定は空配列', () => {
    const items = [{ text: '1001', x: 60, y: 688 }, { text: '980', x: 463, y: 688 }]
    expect(extractRows(items, [{ field: 'code', x: 60 }, { field: 'price', x: 420 }], {})).toEqual([])
  })

  it('列が1つ以下、または不正入力は空配列', () => {
    expect(extractRows([], columns, {})).toEqual([])
    expect(extractRows([{ text: 'x', x: 1, y: 1 }], [{ field: 'name', x: 1 }], {})).toEqual([])
    expect(extractRows(null, columns, {})).toEqual([])
  })
})
