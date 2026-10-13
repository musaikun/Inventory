// server側の入力検証（validate.js）の直接テスト。
// 「業務契約に合わないものは直さずに拒否する」が方針なので、通すものと拒否するものの境目を固定する。
// 呼び出し側（入出庫・発注・完了・取込）は null / undefined を見て 400 にする。
import { describe, it, expect } from 'vitest'
import {
  isValidDate, parseDate, parseClientId, parseQty, parseOptionalNumber, parseEnum, parseCount,
  jsonByteLength, text, assertParamBudget, valueRows, chunk,
} from './validate.js'
import { MAX_ID_LEN, D1_MAX_BOUND_PARAMS } from './constants.js'

describe('日付', () => {
  it('YYYY-MM-DD で実在する日だけ通す', () => {
    expect(isValidDate('2026-10-12')).toBe(true)
    expect(isValidDate('2024-02-29')).toBe(true)                 // うるう年
    for (const v of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-01', '2026/10/12', '2026-10-12T00:00:00Z', '', null, 20261012]) {
      expect(isValidDate(v), String(v)).toBe(false)
    }
  })
  it('未指定は今日、形式不正は null', () => {
    expect(parseDate(undefined, '2026-10-12')).toBe('2026-10-12')
    expect(parseDate('', '2026-10-12')).toBe('2026-10-12')
    expect(parseDate('2026-10-01', '2026-10-12')).toBe('2026-10-01')
    expect(parseDate('2026-02-30', '2026-10-12')).toBeNull()
  })
})

describe('端末が作るID', () => {
  it('未指定は null（サーバーが作る）、形が違えば undefined（拒否）', () => {
    expect(parseClientId(undefined)).toBeNull()
    expect(parseClientId('')).toBeNull()
    expect(parseClientId('mv_2026-10-12_abc')).toBe('mv_2026-10-12_abc')
    expect(parseClientId('x'.repeat(MAX_ID_LEN))).toBe('x'.repeat(MAX_ID_LEN))
    for (const v of ['x'.repeat(MAX_ID_LEN + 1), 'a b', 'a/b', "a'b", '日本語', 123, {}]) {
      expect(parseClientId(v), String(v)).toBeUndefined()
    }
  })
})

describe('数量', () => {
  const range = { min: 0, max: 1000 }
  it('数値と数値の文字列は範囲内なら通す', () => {
    expect(parseQty(0, range)).toBe(0)
    expect(parseQty('2.5', range)).toBe(2.5)
    expect(parseQty(' 3 ', range)).toBe(3)                        // 前後の空白は数値として読む
    expect(parseQty(1000, range)).toBe(1000)
  })
  it('空・NaN・Infinity・範囲外・真偽値・配列は 0 に丸めず拒否する', () => {
    for (const v of ['', ' ', '\t\n', null, undefined, 'abc', NaN, Infinity, -Infinity, -0.1, 1000.1, true, false, [], [3]]) {
      expect(parseQty(v, range), String(v)).toBeNull()
    }
  })
  it('任意の数値は、未指定なら null、指定されて不正なら undefined', () => {
    expect(parseOptionalNumber(null, range)).toBeNull()
    expect(parseOptionalNumber('', range)).toBeNull()
    expect(parseOptionalNumber('  ', range)).toBeNull()           // 空白だけは「未指定」（0 にしない）
    expect(parseOptionalNumber('12', range)).toBe(12)
    expect(parseOptionalNumber('abc', range)).toBeUndefined()
    expect(parseOptionalNumber(-1, range)).toBeUndefined()
    expect(parseOptionalNumber(Infinity, range)).toBeUndefined()
  })
})

describe('列挙値・件数', () => {
  it('許可リストに無い値は既定値に倒さず undefined', () => {
    expect(parseEnum(undefined, ['in', 'out'])).toBeNull()
    expect(parseEnum('in', ['in', 'out'])).toBe('in')
    expect(parseEnum('IN', ['in', 'out'])).toBeUndefined()
    expect(parseEnum('move', ['in', 'out'])).toBeUndefined()
  })
  it('件数は0以上の整数だけ', () => {
    expect(parseCount(null, 10)).toBeNull()
    expect(parseCount(' ', 10)).toBeNull()                         // 空白だけは「未指定」（0 にしない）
    expect(parseCount('3', 10)).toBe(3)
    expect(parseCount(0, 10)).toBe(0)
    for (const v of [-1, 1.5, 11, 'abc', Infinity]) expect(parseCount(v, 10), String(v)).toBeUndefined()
  })
})

describe('文字列・サイズ', () => {
  it('text は trim して上限で切る（拒否はしない）', () => {
    expect(text('  メモ  ', 10)).toBe('メモ')
    expect(text('あいうえお', 3)).toBe('あいう')
    expect(text(null, 5)).toBe('')
    expect(text(123, 5)).toBe('123')
  })
  it('JSONのUTF-8バイト数。直列化できない値は Infinity（拒否側）', () => {
    expect(jsonByteLength({ a: 'あ' })).toBe(new TextEncoder().encode('{"a":"あ"}').byteLength)
    expect(jsonByteLength(null)).toBe(2)                       // {} として数える
    const loop = {}; loop.self = loop
    expect(jsonByteLength(loop)).toBe(Infinity)
    expect(jsonByteLength({ n: 10n })).toBe(Infinity)
  })
})

describe('複数行を1文へまとめる', () => {
  it('bound parameter の上限を超える組み方は投げる', () => {
    expect(assertParamBudget(10, 5, 2)).toBe(52)
    expect(assertParamBudget(1, D1_MAX_BOUND_PARAMS, 0)).toBe(D1_MAX_BOUND_PARAMS)
    expect(() => assertParamBudget(1, D1_MAX_BOUND_PARAMS, 1)).toThrow(/budget exceeded/)
  })
  it('VALUES の行ソースと列名の対応を返す（UNION ALL を使わない）', () => {
    const { sql, col } = valueRows(2, ['item', 'qty'])
    expect(sql).toBe('(?, ?), (?, ?)')
    expect(sql).not.toMatch(/UNION/i)
    expect(col).toEqual({ item: 'v.column1', qty: 'v.column2' })
  })
  it('chunk は順番を保って size ごとに分ける', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
