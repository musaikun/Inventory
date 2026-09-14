import { describe, it, expect } from 'vitest'
import { sortHiddenByRecent, hiddenAtLabel } from './hiddenItems.js'

describe('sortHiddenByRecent', () => {
  it('最後に隠した品目が先頭に来る', () => {
    const at = {
      トマト: '2026-09-05T10:00:00.000Z',
      レタス: '2026-09-07T09:00:00.000Z',
      なす:   '2026-09-06T12:00:00.000Z',
    }
    expect(sortHiddenByRecent(['トマト', 'レタス', 'なす'], at)).toEqual(['レタス', 'なす', 'トマト'])
  })

  // 誤操作は連続して起きる。2件続けて隠しても、上から順に「直前・その前」で読める。
  it('同じ操作で続けて隠した2件は、あとの1件が上に来る', () => {
    const at = { A: '2026-09-07T09:00:00.000Z', B: '2026-09-07T09:00:01.000Z' }
    expect(sortHiddenByRecent(['A', 'B'], at)).toEqual(['B', 'A'])
  })

  it('時刻が無い品目は後ろへ回り、元の並び順を保つ', () => {
    const at = { 新: '2026-09-07T09:00:00.000Z' }
    expect(sortHiddenByRecent(['古1', '新', '古2'], at)).toEqual(['新', '古1', '古2'])
  })

  it('元の配列を書き換えない', () => {
    const names = ['A', 'B']
    sortHiddenByRecent(names, { B: '2026-09-07T09:00:00.000Z' })
    expect(names).toEqual(['A', 'B'])
  })

  it('時刻が1つも無ければ元の順のまま', () => {
    expect(sortHiddenByRecent(['A', 'B', 'C'], {})).toEqual(['A', 'B', 'C'])
    expect(sortHiddenByRecent(['A', 'B'])).toEqual(['A', 'B'])
  })
})

describe('hiddenAtLabel', () => {
  const now = new Date(2026, 8, 7, 15, 30)   // 2026-09-07 15:30（ローカル）
  const iso = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).toISOString()

  it('同じ日は「今日 H:MM」', () => {
    expect(hiddenAtLabel(iso(2026, 9, 7, 13, 4), now)).toBe('今日 13:04')
  })

  it('前日は「昨日 H:MM」', () => {
    expect(hiddenAtLabel(iso(2026, 9, 6, 22, 5), now)).toBe('昨日 22:05')
  })

  it('同じ年のそれ以前は「M/D H:MM」', () => {
    expect(hiddenAtLabel(iso(2026, 9, 5, 18, 2), now)).toBe('9/5 18:02')
  })

  it('年をまたぐと年から出す', () => {
    expect(hiddenAtLabel(iso(2025, 9, 5, 18, 2), now)).toBe('2025/9/5')
  })

  it('空・不正な値は空文字（表示しない）', () => {
    expect(hiddenAtLabel('', now)).toBe('')
    expect(hiddenAtLabel(null, now)).toBe('')
    expect(hiddenAtLabel('これは日付ではない', now)).toBe('')
  })

  // 月初の「昨日」は月をまたぐ。Date の日付繰り下がりに任せる。
  it('月初の前日も昨日として出す', () => {
    const first = new Date(2026, 8, 1, 10, 0)
    expect(hiddenAtLabel(iso(2026, 8, 31, 23, 40), first)).toBe('昨日 23:40')
  })
})
