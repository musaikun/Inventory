import { describe, it, expect } from 'vitest'
import { countSequences, latestCountOrder, orderByCount, countRows, splitRows } from './countOrder.js'

const e = (ingredient, action, t, who = 'a') => ({ ingredient, action, timestamp: t, enteredById: who, enteredBy: who === 'a' ? '高木' : '山田' })

describe('countSequences', () => {
  it('数えた時刻の順。上書き・取り消しと、直前と同じ品目の連続は使わない', () => {
    const snap = { auditLog: [e('牛乳', 'new', 1), e('卵', 'new', 3), e('卵', 'add', 4), e('牛乳', 'overwrite', 5), e('塩', 'new', 6), e('卵', 'remove', 7), e('チーズ', 'new', 2)] }
    expect(countSequences(snap)).toEqual([{ who: '高木', items: ['牛乳', 'チーズ', '卵', '塩'] }])
  })
  it('複数人は担当者ごと。離れてもう一度出てきた品目は2か所に置く。数え始めの早い人から', () => {
    const snap = { auditLog: [e('パスタ', 'new', 2, 'b'), e('牛乳', 'new', 1), e('トマト缶', 'new', 3), e('トマト缶', 'add', 4, 'b'), e('アイス', 'new', 5), e('トマト缶', 'add', 6)] }
    expect(countSequences(snap)).toEqual([
      { who: '高木', items: ['牛乳', 'トマト缶', 'アイス', 'トマト缶'] },
      { who: '山田', items: ['パスタ', 'トマト缶'] },
    ])
  })
  it('今ない品目は落とす。変更履歴が無ければ入力順', () => {
    expect(countSequences({ auditLog: [e('牛乳', 'new', 1), e('消えた', 'new', 2)] }, new Set(['牛乳']))[0].items).toEqual(['牛乳'])
    expect(countSequences({ entryLog: ['b', 'a', 'b'] })).toEqual([{ who: '', items: ['b', 'a'] }])
  })
})

describe('latestCountOrder', () => {
  it('新しい順に見て、数えた順が取れる最初の棚卸。過去データの取込は飛ばす', () => {
    const snaps = [
      { date: '2026-10-03', importBatchId: 'x', entryLog: ['a', 'b'] },
      { date: '2026-10-02', items: [] },
      { date: '2026-10-01', entryLog: ['a', 'b'] },
    ]
    expect(latestCountOrder(snaps).snap.date).toBe('2026-10-01')
    expect(latestCountOrder([{ entryLog: ['a'] }])).toBeNull()
  })
})

describe('orderByCount', () => {
  it('数えた品目を初めて出た順に先へ、数えていない品目は今の順のまま後ろ', () => {
    const seqs = [{ items: ['c', 'a', 'c'] }, { items: ['e'] }]
    expect(orderByCount(['a', 'b', 'c', 'd', 'e'], seqs)).toEqual(['c', 'a', 'e', 'b', 'd'])
  })
})

describe('countRows / splitRows', () => {
  it('人の切れ目で区切り、2回出る品目に印を付ける', () => {
    const { rows, personCuts } = countRows([{ who: 'A', items: ['x', 'y'] }, { who: 'B', items: ['z', 'x'] }])
    expect(personCuts).toEqual([2])
    expect(rows.map(r => r.multi)).toEqual([true, false, false, true])
    const places = splitRows(rows, new Set([2, 3]))
    expect(places.map(p => p.rows.map(r => r.item))).toEqual([['x', 'y'], ['z'], ['x']])
  })
})
