// ホームの「本日の状況」の行（User決定 2026-11-12・D-042）
import { describe, it, expect } from 'vitest'
import { homeStatus } from './homeStatus.js'

const today = '2026-11-12'
const base = { today, now: '12:30' }
const cl = (id, name, slots, items = [{ id: 'a', text: 'x' }]) => ({ cl: { id, name, assign: 'anyone', items }, slots })

describe('本日の状況', () => {
  it('同じ形で1列: やること・定期・進行中。済んだものは出さない', () => {
    const r = homeStatus({ ...base,
      tasks: [{ id: 't1', text: '仕込み', date: today, doneAt: 'x' }, { id: 't2', text: 'トイレ掃除', date: today, dueTime: '14:00', assign: 'person', assigneeName: '高木' }],
      checklists: [cl('c1', '開店準備', [{ slot: '15:30', filled: 1, total: 3, complete: false }]), cl('c2', 'レジ金', [{ slot: '09:30', filled: 2, total: 2, complete: true }])],
      progress: [{ id: 'p1', text: '見積もり', date: '2026-11-10', deadline: '2026-11-30', progress: 'doing', steps: [{ done: true }, { done: false }] }],
    })
    expect(r.rows.map(x => x.title)).toEqual(['トイレ掃除', '開店準備', '見積もり'])
    expect(r.rows[0]).toMatchObject({ tag: null, pct: 0, left: '高木', right: '本日 14:00', ref: { type: 'task', id: 't2' } })
    expect(r.rows[1]).toMatchObject({ kind: '定期', left: '1/3', ref: { type: 'list', clId: 'c1', slot: '15:30' } })
    expect(r.rows[1].pct).toBeCloseTo(1 / 3)
    expect(r.rows[2]).toMatchObject({ kind: '進行中', pct: 0.5, right: '11/10〜11/30', ref: { type: 'progress', id: 'p1' } })
    expect(r.rows[2].plan).toBeCloseTo(2 / 20)                  // 予定ではここまで（始まり〜締め切りの今日の位置）
  })
  it('札は 遅れ／本日まで／明日まで だけ。並びも その順', () => {
    const r = homeStatus({ ...base,
      tasks: [{ id: 'a', text: 'ふつう', date: today, dueTime: '18:00' }, { id: 'b', text: '時刻を過ぎた', date: today, dueTime: '10:00' }],
      overdue: [{ id: 'o', text: '前の日の', date: '2026-11-09' }],
      progress: [
        { id: 'p3', text: '先', date: '2026-11-01', deadline: '2026-11-20', progress: 'doing' },
        { id: 'p2', text: '明日', date: '2026-11-01', deadline: '2026-11-13', progress: 'doing' },
        { id: 'p1', text: '今日', date: '2026-11-01', deadline: today, progress: 'doing' },
        { id: 'p0', text: '過ぎた', date: '2026-11-01', deadline: '2026-11-10', progress: 'doing' },
      ],
    })
    expect(r.rows.map(x => [x.title, x.tag?.label ?? ''])).toEqual([
      ['前の日の', '3日遅れ'], ['時刻を過ぎた', '遅れ'], ['過ぎた', '2日遅れ'],   // 遅れの中は 前の日のやること → 今日の → 進行中
      ['今日', '本日まで'], ['明日', '明日まで'], ['ふつう', ''], ['先', ''],
    ])
    expect(r.rows.find(x => x.title === '今日').right).toBe('11/1〜本日')
  })
  it('多いときは max 行まで（残りは more）。進行中の数を返す', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, text: `t${i}`, date: today }))
    const r = homeStatus({ ...base, tasks, progress: [{ id: 'p', text: 'p', progress: 'doing', date: today }] }, 8)
    expect(r.rows).toHaveLength(8)
    expect(r.more).toBe(3)
    expect(r.progressCount).toBe(1)
  })
})
