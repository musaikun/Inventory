// ホームの「今日のやること」: 気になる順の一覧（User決定 2026-11-06）
import { describe, it, expect } from 'vitest'
import { homeAttention } from './homeAttention.js'

const T = (id, text, f = {}) => ({ id, text, date: '2099-01-02', assign: 'anyone', ...f })
const mine = t => t.assign === 'person' && t.assigneeId === 'me'

describe('homeAttention', () => {
  it('期限切れ → 遅れ（やること・チェック表を時刻順）→ 止まっている → 自分の → 次の時刻 の順。件数は全部を数える', () => {
    const r = homeAttention({
      overdue: [T('o1', '発注書の確認', { date: '2099-01-01' })],
      today: [
        T('a', '揚げ油の交換', { dueTime: '15:00', assign: 'person', assigneeName: '佐藤' }),
        T('b', '仕込み', { dueTime: '13:00' }),
        T('c', '発注の確認', { dueTime: '16:00', assign: 'person', assigneeId: 'me', assigneeName: '高木' }),
        T('d', '済んだもの', { dueTime: '10:00', doneAt: 'x' }),
        T('e', '進行中は出さない', { progress: 'doing' }),
      ],
      stale: [T('s', '棚のラベル', { progress: 'doing' })],
      checklists: [{ cl: { id: 'k', name: 'ランチ後の片付け' }, slots: [{ slot: '14:00', complete: false, filled: 2, total: 6 }] }],
      now: '14:40', isMine: mine,
    })
    expect(r.rows.map(x => [x.kind, x.tag, x.text])).toEqual([
      ['over', '期限切れ', '発注書の確認'],
      ['late', '遅れ 1時間', '仕込み'],
      ['late', '遅れ 40分', 'ランチ後の片付け（2/6）'],
      ['stuck', '止まっている', '棚のラベル'],
      ['mine', 'あなた', '発注の確認'],
    ])
    expect(r.more).toBe(1)
    expect(r.counts).toEqual({ over: 1, late: 2, stuck: 1, mine: 1 })
    expect(r.rows[0].side).toBe('1/1')
  })

  it('何も無ければ空・件数0', () => {
    const r = homeAttention({ now: '09:00' })
    expect(r).toEqual({ rows: [], more: 0, counts: { over: 0, late: 0, stuck: 0, mine: 0 } })
  })

  it('時刻前のものは遅れにせず「次」に。済んだ回のチェック表は出さない', () => {
    const r = homeAttention({
      today: [T('a', '閉店チェック前の片付け', { dueTime: '22:00', assign: 'all' })],
      checklists: [{ cl: { id: 'k', name: '開店チェック' }, slots: [{ slot: '10:00', complete: true, filled: 5, total: 5 }] }],
      now: '12:00',
    })
    expect(r.rows).toEqual([expect.objectContaining({ kind: 'next', tag: '22:00', side: '全員' })])
    expect(r.counts.late).toBe(0)
  })
})
