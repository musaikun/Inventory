import { describe, it, expect } from 'vitest'
import { matchRow, matchImportRows } from './deliveryImportMatch.js'

const ctx = {
  order: ['玉ねぎ', '鶏もも', 'コーヒー豆 ブラジル'],
  dictionary: { 'たまねぎ': '玉ねぎ', 'オニオン': '玉ねぎ' },
  masterDict: { '豆': ['コーヒー豆 ブラジル'] },
  categories: {},
}

describe('matchRow', () => {
  it('正式品目名と完全一致 → matched', () => {
    expect(matchRow('玉ねぎ', ctx)).toEqual({ status: 'matched', item: '玉ねぎ', candidates: ['玉ねぎ'] })
  })

  it('完全なエイリアス一致 → matched（正規化で表記ゆれ吸収）', () => {
    expect(matchRow('たまねぎ', ctx)).toMatchObject({ status: 'matched', item: '玉ねぎ' })
    expect(matchRow('オニオン', ctx)).toMatchObject({ status: 'matched', item: '玉ねぎ' })
  })

  it('マスター辞書キーワードと完全一致 → matched', () => {
    expect(matchRow('豆', ctx)).toMatchObject({ status: 'matched', item: 'コーヒー豆 ブラジル' })
  })

  it('部分一致のみ → candidate（先頭を既定サジェスト）', () => {
    const r = matchRow('コーヒー豆', ctx)
    expect(r.status).toBe('candidate')
    expect(r.candidates).toContain('コーヒー豆 ブラジル')
    expect(r.item).toBe('コーヒー豆 ブラジル')
  })

  it('候補なし → unmatched', () => {
    expect(matchRow('謎の食材ZZ', ctx)).toEqual({ status: 'unmatched', item: null, candidates: [] })
  })

  it('空名は unmatched', () => {
    expect(matchRow('', ctx)).toEqual({ status: 'unmatched', item: null, candidates: [] })
  })

  it('マスター辞書の指す品目が order に無ければ matched にしない', () => {
    const r = matchRow('豆', { order: ['玉ねぎ'], masterDict: { '豆': ['存在しない品目'] } })
    expect(r.status).toBe('unmatched')
  })
})

describe('matchImportRows', () => {
  it('行ごとの解決と集計を返す', () => {
    const rows = [
      { name: '玉ねぎ', qty: 3 },       // matched
      { name: 'たまねぎ', qty: 5 },     // matched (alias)
      { name: 'コーヒー豆', qty: 1 },   // candidate
      { name: '謎ZZ', qty: 2 },         // unmatched
    ]
    const { resolved, summary } = matchImportRows(rows, ctx)
    expect(summary).toEqual({ matched: 2, candidate: 1, unmatched: 1 })
    expect(resolved[0]).toMatchObject({ name: '玉ねぎ', qty: 3, match: { status: 'matched', item: '玉ねぎ' } })
    expect(resolved[3].match.status).toBe('unmatched')
  })
})
