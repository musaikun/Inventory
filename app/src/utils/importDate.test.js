/**
 * IMPORT-001 — 取込の日付は「月日の範囲」ではなく**実在する日**であることを確かめる。
 *
 * 修正前は月 1..12 / 日 1..31 だけを見ていたため、`2026-02-30` や `2025-02-29` が
 * そのまま 'YYYY-MM-DD' として通り、存在しない日の棚卸セッションが作られていた。
 * ここでは ISO 化したあとに年月日を round-trip して確認する。
 */
import { describe, it, expect } from 'vitest'
import { normalizeImportDate } from './importDate.js'

describe('実在する日だけを受理する', () => {
  it('閏年の2月29日は受理する', () => {
    expect(normalizeImportDate('2024-02-29')).toBe('2024-02-29')
    expect(normalizeImportDate('2000-02-29')).toBe('2000-02-29')
  })

  it('平年の2月29日は拒否する', () => {
    expect(normalizeImportDate('2025-02-29')).toBe('')
    // 100年ルール（400で割れない世紀年は平年）
    expect(normalizeImportDate('1900-02-29')).toBe('')
  })

  it('存在しない2月30日・2月31日を拒否する', () => {
    expect(normalizeImportDate('2026-02-30')).toBe('')
    expect(normalizeImportDate('2026-02-31')).toBe('')
  })

  it('31日の無い月の31日を拒否する', () => {
    expect(normalizeImportDate('2026-04-31')).toBe('')
    expect(normalizeImportDate('2026-06-31')).toBe('')
    expect(normalizeImportDate('2026-09-31')).toBe('')
    expect(normalizeImportDate('2026-11-31')).toBe('')
  })

  it('月・日の範囲外は従来どおり拒否する', () => {
    expect(normalizeImportDate('2026-00-10')).toBe('')
    expect(normalizeImportDate('2026-13-01')).toBe('')
    expect(normalizeImportDate('2026-01-00')).toBe('')
    expect(normalizeImportDate('2026-01-32')).toBe('')
  })
})

describe('既存の表記ゆれを引き続き正規化する', () => {
  it('スラッシュ・ドット・年月日を YYYY-MM-DD へ寄せる', () => {
    expect(normalizeImportDate('2026/6/1')).toBe('2026-06-01')
    expect(normalizeImportDate('2026.6.1')).toBe('2026-06-01')
    expect(normalizeImportDate('2026年6月1日')).toBe('2026-06-01')
    expect(normalizeImportDate(' 2026-06-01 ')).toBe('2026-06-01')
  })

  it('正規化した表記でも実在判定は同じ', () => {
    expect(normalizeImportDate('2024/2/29')).toBe('2024-02-29')
    expect(normalizeImportDate('2025/2/29')).toBe('')
    expect(normalizeImportDate('2026年4月31日')).toBe('')
  })

  it('空・解釈できない文字列は空文字を返す', () => {
    expect(normalizeImportDate('')).toBe('')
    expect(normalizeImportDate(null)).toBe('')
    expect(normalizeImportDate('きのう')).toBe('')
    expect(normalizeImportDate('20260601')).toBe('')
  })
})
