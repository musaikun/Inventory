/**
 * IMPORT-001 — PDF/Excel から品目CSVへ変換する経路の回帰テスト。
 *
 * 修正前は単価から数字以外を削っていたため、`-100` が `100`、`abc100` が `100` になり、
 * **取込前の確認画面にも正しい値として並んでいた**（黙って別のデータになる）。
 * また値を `"..."` で囲むだけだったので、引用符を含む品目名・単位で列がずれた。
 *
 * ここでは「変換が数値を直さないこと」と「往復して元の文字列に戻ること」を見る。
 */
import { describe, it, expect } from 'vitest'
import { itemsToConfigCSV } from './usePdfImporter.js'
import { tokenizeCSV } from '../utils/csvParse.js'
import { parseItemCSV } from '../utils/itemImport.js'

const cells = (csv) => tokenizeCSV(csv).rows.map(r => r.cols)

describe('itemsToConfigCSV — 数値を直さない', () => {
  it('-100 を 100 にしない（元のセル値のまま渡す）', () => {
    const rows = cells(itemsToConfigCSV([{ name: 'トマト', unit: '箱', price: '-100' }]))
    expect(rows[1][2]).toBe('-100')
  })

  it('abc100 / 12abc から数字を抜き出さない', () => {
    const rows = cells(itemsToConfigCSV([
      { name: 'トマト', price: 'abc100' },
      { name: 'レタス', price: '12abc' },
    ]))
    expect(rows[1][2]).toBe('abc100')
    expect(rows[2][2]).toBe('12abc')
  })

  it('不正な単価は共通の数値契約で行エラーになり、黙って取り込まれない', () => {
    const csv = itemsToConfigCSV([
      { name: 'トマト', unit: '箱', price: '-100' },
      { name: 'レタス', unit: '玉', price: '120' },
    ])
    const parsed = parseItemCSV(csv)
    expect(parsed.rows.map(r => r.name)).toEqual(['レタス'])
    expect(parsed.errors[0]).toMatchObject({ line: 2, columnLabel: '単価', value: '-100' })
  })

  it('正しい桁区切り・小数は通す', () => {
    const parsed = parseItemCSV(itemsToConfigCSV([
      { name: 'トマト', price: '1,200' },
      { name: 'レタス', price: '0.5' },
    ]))
    expect(parsed.rows[0].price).toBe(1200)
    expect(parsed.rows[1].price).toBe(0.5)
  })
})

describe('itemsToConfigCSV — カンマ・引用符・改行のエスケープ', () => {
  it('引用符を含む品目名・単位を壊さずに往復する', () => {
    const csv = itemsToConfigCSV([
      { name: '5" 皿 セット', unit: '5" 箱', category: 'a,b', aliases: ['さら"', 'プレート'] },
    ])
    const [, row] = cells(csv)
    expect(row[0]).toBe('5" 皿 セット')
    expect(row[1]).toBe('5" 箱')
    expect(row[3]).toBe('a,b')
    expect(row[4]).toContain('さら"')

    // 取込側でも同じ値として読める（列がずれない）。
    // 別名は取り込まないので、5列目の値は読み捨てる（列の位置はずれない）。
    const parsed = parseItemCSV(csv)
    expect(parsed.rows[0].name).toBe('5" 皿 セット')
    expect(parsed.rows[0].unit).toBe('5" 箱')
    expect(parsed.rows[0].aliases).toEqual([])
  })

  it('カンマを含む品目名で列がずれない', () => {
    const csv = itemsToConfigCSV([{ name: 'トマト, 大玉', unit: '箱', price: '120' }])
    const [, row] = cells(csv)
    expect(row).toHaveLength(9)
    expect(row[0]).toBe('トマト, 大玉')
    expect(row[2]).toBe('120')
  })

  it('改行を含む値を1セルとして保つ', () => {
    const csv = itemsToConfigCSV([{ name: 'トマト', unit: '箱\n(大)' }])
    const [, row] = cells(csv)
    expect(row[1]).toBe('箱\n(大)')
  })
})
