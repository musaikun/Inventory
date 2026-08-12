import { describe, it, expect } from 'vitest'
import {
  tokenizeCSV, parseCSVLine, parseNumericCell, readNumericCell,
  csvEscapeCell, toCSVRow, CSV_ERROR_UNCLOSED_QUOTE,
} from './csvParse.js'

const cols = (text) => tokenizeCSV(text).rows.map(r => r.cols)

describe('tokenizeCSV', () => {
  it('引用符内のカンマを区切りにしない', () => {
    expect(cols('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('"" を値の中の " 1文字として読む（エスケープされた引用符）', () => {
    expect(cols('品目名\n"5"" 皿"')).toEqual([['品目名'], ['5" 皿']])
    expect(cols('"a""b",c')).toEqual([['a"b', 'c']])
  })

  it('引用符内の改行を1セルの一部として保つ', () => {
    const r = tokenizeCSV('名前,備考\n"トマト","産地\n熊本"')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[1].cols).toEqual(['トマト', '産地\n熊本'])
  })

  it('引用符内に改行があってもレコードの開始行番号を保つ', () => {
    const r = tokenizeCSV('h\n"a\nb"\nc')
    expect(r.rows.map(x => x.line)).toEqual([1, 2, 4])
  })

  it('閉じていない引用符を黙って受理せず、開始行つきのエラーにする', () => {
    const r = tokenizeCSV('品目名,単位\nトマト,個\n"レタス,玉')
    expect(r.error).toMatchObject({ code: CSV_ERROR_UNCLOSED_QUOTE, line: 3 })
    expect(r.rows).toEqual([])
  })

  it('CRLF / LF / CR を同じ結果へ寄せる', () => {
    const want = [['a', 'b'], ['c', 'd']]
    expect(cols('a,b\r\nc,d')).toEqual(want)
    expect(cols('a,b\nc,d')).toEqual(want)
    expect(cols('a,b\rc,d')).toEqual(want)
  })

  it('先頭 BOM を取り除く', () => {
    expect(cols('﻿品目名,単位\nトマト,個')).toEqual([['品目名', '単位'], ['トマト', '個']])
  })

  it('日本語・末尾改行なし・末尾の空行を正しく扱う', () => {
    expect(cols('品目名,単位\nトマト,個')).toEqual([['品目名', '単位'], ['トマト', '個']])
    expect(cols('品目名,単位\r\nトマト,個\r\n\r\n')).toEqual([['品目名', '単位'], ['トマト', '個']])
  })

  it('空行を捨てても、後続レコードの行番号はファイルと一致する', () => {
    const r = tokenizeCSV('品目名\n\n\nトマト')
    expect(r.rows.map(x => x.line)).toEqual([1, 4])
  })

  it('空文字セルを保つ（列数を落とさない）', () => {
    expect(cols('a,,c')).toEqual([['a', '', 'c']])
    expect(cols('品目名,単位,単価\nトマト,,')).toEqual([['品目名', '単位', '単価'], ['トマト', '', '']])
  })

  it('parseCSVLine は1行だけをセルへ分解する', () => {
    expect(parseCSVLine('a,"b,c"')).toEqual(['a', 'b,c'])
    expect(parseCSVLine('')).toEqual([''])
  })
})

describe('parseNumericCell', () => {
  it('桁区切りの "1,200" を 1 ではなく 1200 と読む', () => {
    expect(parseNumericCell('1,200')).toEqual({ value: 1200 })
    expect(parseNumericCell('1,234,567')).toEqual({ value: 1234567 })
    expect(parseNumericCell('1,200.5')).toEqual({ value: 1200.5 })
  })

  it('桁区切りとして成立しない形は不正として返す（先頭だけ採用しない）', () => {
    expect(parseNumericCell('1,20')).toMatchObject({ invalid: true })
    expect(parseNumericCell('1,2345')).toMatchObject({ invalid: true })
    expect(parseNumericCell('12,34,56')).toMatchObject({ invalid: true })
  })

  it('数値でない文字列を不正として返す', () => {
    for (const v of ['abc', '12abc', '--3', '1.2.3', '¥', '-']) {
      expect(parseNumericCell(v), v).toMatchObject({ invalid: true })
    }
  })

  it('空セルは empty（未指定）として区別する', () => {
    expect(parseNumericCell('')).toEqual({ empty: true })
    expect(parseNumericCell('   ')).toEqual({ empty: true })
    expect(parseNumericCell(null)).toEqual({ empty: true })
    expect(parseNumericCell(undefined)).toEqual({ empty: true })
  })

  it('通貨記号・前後の空白・全角数字を受け付ける', () => {
    expect(parseNumericCell('¥1,200')).toEqual({ value: 1200 })
    expect(parseNumericCell(' 150 ')).toEqual({ value: 150 })
    expect(parseNumericCell('１２０')).toEqual({ value: 120 })
    expect(parseNumericCell('１，２００')).toEqual({ value: 1200 })
  })

  it('値の中に混ざった空白は桁区切りとして解釈しない', () => {
    // `1 2` を 12 にしたり、parseFloat のように先頭の 1 だけ採ったりしない
    for (const v of ['1 2', '1 200', '12 abc', '1\u30002']) {
      expect(parseNumericCell(v), v).toMatchObject({ invalid: true })
    }
  })

  it('前方一致で数字を拾わない（12abc / abc100 / -abc）', () => {
    for (const v of ['12abc', 'abc100', '100円', '-abc', '1.2.3', '--1', '.', '-']) {
      expect(parseNumericCell(v), v).toMatchObject({ invalid: true })
    }
  })

  it('負数・小数・0 をそのまま返す（範囲の判断は呼び出し側）', () => {
    expect(parseNumericCell('0')).toEqual({ value: 0 })
    expect(parseNumericCell('-5')).toEqual({ value: -5 })
    expect(parseNumericCell('0.25')).toEqual({ value: 0.25 })
  })

  it('Infinity / NaN 表記を数値として受け付けない', () => {
    expect(parseNumericCell('Infinity')).toMatchObject({ invalid: true })
    expect(parseNumericCell('NaN')).toMatchObject({ invalid: true })
    expect(parseNumericCell('1e5')).toMatchObject({ invalid: true })
  })
})

describe('readNumericCell — 全取込入口で共通のエラー形', () => {
  it('不正値は行番号・列・元の値・理由を持つエラーになる', () => {
    const r = readNumericCell('12abc', { line: 7, column: 2, columnLabel: '単価' })
    expect(r.error).toMatchObject({
      line: 7, column: 2, columnLabel: '単価', value: '12abc',
    })
    expect(r.error.reason).toContain('数値として読めません')
  })

  it('空欄はエラーにしない（未入力と不正を分ける）', () => {
    expect(readNumericCell('', { line: 2 })).toEqual({ empty: true })
  })

  it('positive は 0 と負数を拒否する', () => {
    expect(readNumericCell('0',    { line: 2, columnLabel: '単価', positive: true }).error.reason).toContain('0より大きい')
    expect(readNumericCell('-100', { line: 2, columnLabel: '単価', positive: true }).error.value).toBe('-100')
  })

  it('既定では負数を拒否し、allowNegative で許可する', () => {
    expect(readNumericCell('-100', { line: 3, columnLabel: '数量' }).error.reason).toContain('0以上')
    expect(readNumericCell('-100', { line: 3, allowNegative: true })).toEqual({ value: -100 })
  })

  it('正しい 1,200 と小数はそのまま通す', () => {
    expect(readNumericCell('1,200', { line: 2 })).toEqual({ value: 1200 })
    expect(readNumericCell('0.5',   { line: 2 })).toEqual({ value: 0.5 })
    expect(readNumericCell('1,200.25', { line: 2 })).toEqual({ value: 1200.25 })
  })
})

describe('csvEscapeCell / toCSVRow — 書き出しと読み戻しの往復', () => {
  it('カンマ・改行・引用符を含む値だけを囲み、引用符を倍にする', () => {
    expect(csvEscapeCell('トマト')).toBe('トマト')
    expect(csvEscapeCell('a,b')).toBe('"a,b"')
    expect(csvEscapeCell('5" 皿')).toBe('"5"" 皿"')
    expect(csvEscapeCell('1行目\n2行目')).toBe('"1行目\n2行目"')
    expect(csvEscapeCell('')).toBe('')
    expect(csvEscapeCell(null)).toBe('')
  })

  it('formulaGuard で数式始まりの文字列を無害化する', () => {
    expect(csvEscapeCell('=1+1', { formulaGuard: true })).toBe("'=1+1")
    expect(csvEscapeCell('=1+1')).toBe('=1+1')
  })

  it('引用符・カンマ・改行を含むセルが tokenizeCSV で元の値に戻る', () => {
    const cells = ['5" 皿', 'a,b', '改行\nあり', '通常', '']
    const [row] = tokenizeCSV(toCSVRow(cells)).rows
    expect(row.cols).toEqual(cells)
  })
})
