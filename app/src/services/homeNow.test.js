// ホームの「店の今」: ① 今日の流れ ② 進行中（User決定 2026-11-08）
import { describe, it, expect } from 'vitest'
import { todayFlow, progressBars, blockState } from './homeNow.js'

const T = (id, text, f = {}) => ({ id, text, date: '2099-01-02', assign: 'all', ...f })

describe('todayFlow', () => {
  it('担当ごとの行に帯。終わりが無ければ30分。済み・今・遅れ・これから。行は最初の帯が早い順', () => {
    const r = todayFlow({
      now: '14:40',
      tasks: [
        T('a', '発注の確認', { dueTime: '15:00', assign: 'person', assigneeId: 'u1', assigneeName: '高木' }),
        T('b', '仕込み', { dueTime: '10:00', endTime: '11:30', assign: 'person', assigneeId: 'u1', assigneeName: '高木', doneAt: 'x' }),
        T('c', '片付け', { dueTime: '14:00', endTime: '15:00', assign: 'person', assigneeId: 'u2', assigneeName: '山田' }),
        T('d', '検品', { dueTime: '13:00', assign: 'person', assigneeId: 'u2', assigneeName: '山田' }),
        T('e', '時刻なしは出さない'),
        T('f', '進行中は出さない', { dueTime: '09:00', progress: 'doing' }),
      ],
      checklists: [{ cl: { id: 'k', name: '閉店チェック', assign: 'all' }, slots: [{ slot: '22:30', complete: false }, { slot: '', complete: false }] }],
    })
    expect(r.rows.map(x => [x.name, x.blocks.map(b => [b.text, b.state])])).toEqual([
      ['高木', [['仕込み', 'done'], ['発注の確認', 'plan']]],
      ['山田', [['検品', 'late'], ['片付け', 'now']]],
      ['全員', [['閉店チェック', 'plan']]],
    ])
    expect(r.from).toBe(600)
    expect(r.to).toBe(1380)
    expect(r.now).toBe(880)
    expect(r.rows[0].blocks[1]).toMatchObject({ start: 900, end: 930 })
  })

  it('何も無ければ行なし。範囲は最低6時間', () => {
    expect(todayFlow({ now: '09:00' }).rows).toEqual([])
    const r = todayFlow({ now: '12:00', tasks: [T('a', 'x', { dueTime: '12:30' })] })
    expect(r.to - r.from).toBeGreaterThanOrEqual(360)
    expect(r.from).toBeLessThanOrEqual(720)
  })

  it('blockState', () => {
    expect(blockState({ start: 0, end: 10, done: true }, 5)).toBe('done')
    expect(blockState({ start: 0, end: 10 }, 5)).toBe('now')
    expect(blockState({ start: 0, end: 10 }, 10)).toBe('late')
    expect(blockState({ start: 0, end: 30, lateAt: 0 }, 5), '終わりの無いものは始まりを過ぎたら遅れ').toBe('late')
    expect(blockState({ start: 20, end: 30 }, 10)).toBe('plan')
  })
})

describe('progressBars', () => {
  it('締め切り過ぎ → 止まっている → 締め切りが近い順 → 締め切りなし。今日の位置と手順の進み', () => {
    const stale = t => t.id === 's'
    const r = progressBars([
      { id: 'n', text: '締め切りなし', progress: 'doing', createdAt: '2099-01-01T00:00:00Z', assign: 'all' },
      { id: 'd', text: '修理の手配', progress: 'waiting', createdAt: '2099-01-01T00:00:00Z', deadline: '2099-01-11', assign: 'person', assigneeName: '佐藤',
        steps: [{ id: 1, done: true }, { id: 2, done: false }] },
      { id: 's', text: 'ラベル', progress: 'doing', createdAt: '2099-01-01T00:00:00Z', deadline: '2099-01-20', assign: 'all' },
      { id: 'o', text: '試作', progress: 'doing', createdAt: '2098-12-20T00:00:00Z', deadline: '2099-01-03', assign: 'all' },
    ], '2099-01-06', stale)
    expect(r.items.map(x => x.id)).toEqual(['o', 's', 'd', 'n'])
    expect(r.items[0]).toMatchObject({ over: true, stale: false, pos: 1 })
    expect(r.items[2]).toMatchObject({ who: '佐藤', done: 1, total: 2, waiting: true, deadline: '2099-01-11' })
    expect(r.items[2].pos).toBeCloseTo(0.5)
    expect(r.items[3]).toMatchObject({ pos: null, deadline: '' })
  })
})
