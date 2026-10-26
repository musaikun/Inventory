import { describe, it, expect } from 'vitest'
import { buildDayTimeline } from './dayTimeline.js'

const at = hm => new Date(`2026-10-26T${hm}:00`).getTime()
const slot = (cl, s, o = {}) => ({ cl, date: '2026-10-26', slot: s, marks: {}, filled: 0, total: cl.items.length || 1, complete: false, lastAt: null, ...o })
const list = (cl, slots) => ({ cl, slots })

describe('日誌のタイムライン（User決定 2026-10-26）', () => {
  it('時刻のないものは終日、ほかは時刻の順（9:05 と 22:00 も文字ではなく時刻の順）。記録と途中の棚卸も並ぶ', () => {
    const cl = { id: 'c1', name: '冷蔵庫の温度', items: [{ id: 'f' }] }
    const tl = buildDayTimeline({
      date: '2026-10-26', today: '2026-10-26',
      tasks: [{ id: 't1', text: '野菜の検品', dueTime: '11:00' }, { id: 't2', text: '手洗い', dueTime: null }],
      late: [{ id: 't0', text: '油の交換', date: '2026-10-24' }],
      lists: [list(cl, [slot(cl, '10:00', { complete: true, filled: 1, marks: { f: { by: '山田' } }, lastAt: '2026-10-26T01:04:00Z' }), slot(cl, '21:00')])],
      records: [{ key: 'in-1', kind: 'in', at: at('09:05'), title: '入庫 2品目', by: '山田', lines: [{ item: 'キャベツ' }] }],
      live: [{ kind: 'stock', session: { startedAt: new Date(at('22:30')).toISOString() }, count: 28 }],
    })
    expect(tl.allDay.map(x => [x.title, x.state])).toEqual([['油の交換', 'missed'], ['手洗い', 'todo']])
    expect(tl.allDay[0].sub).toBe('10/24から')
    expect(tl.timed.map(x => x.time)).toEqual(['09:05', '10:00', '11:00', '21:00', '22:30'])
    expect(tl.timed.map(x => x.title)).toEqual(['入庫 2品目', '冷蔵庫の温度（1回目）', '野菜の検品', '冷蔵庫の温度（2回目）', '棚卸 途中'])
    expect(tl.timed[1]).toMatchObject({ state: 'done', kind: 'ルーティン' })
    expect(tl.timed[4]).toMatchObject({ state: 'live', sub: '28品目' })
    // 数: やること・ルーティン（記録と途中は入れない）
    expect([tl.done, tl.count]).toEqual([1, 5])
  })

  it('過ぎた日の残りは赤（missed）、先の日は予定（plan）。発注の締切は今日と先の日だけ、数に入れない', () => {
    const t = { id: 't', text: '点検', dueTime: '10:00' }
    expect(buildDayTimeline({ date: '2026-10-20', today: '2026-10-26', tasks: [t] }).timed[0].state).toBe('missed')
    const fut = buildDayTimeline({ date: '2026-10-28', today: '2026-10-26', tasks: [t], plans: [{ name: '酒屋', time: '14:00' }] })
    expect(fut.timed.map(x => [x.time, x.title, x.state])).toEqual([['10:00', '点検', 'plan'], ['14:00', '発注の締切（酒屋）', 'plan']])
    expect(fut.count).toBe(0)
    expect(buildDayTimeline({ date: '2026-10-20', today: '2026-10-26', plans: [{ name: '酒屋', time: '14:00' }] }).timed).toEqual([])
  })

  it('棚卸の記録は合計と中断。取り込んだ記録は時刻が無いので終日', () => {
    const tl = buildDayTimeline({
      date: '2026-10-20', today: '2026-10-26',
      records: [
        { key: 's1', kind: 'stock', at: at('10:35'), end: at('16:15'), pauses: [{}, {}], pauseMs: 155 * 60000, title: '棚卸 完了 ・ 40品目', by: '高木・山田' },
        { key: 's2', kind: 'stock', at: null, end: null, imported: true, title: '棚卸 完了 ・ 10品目' },
      ],
    })
    expect(tl.timed[0].sub).toBe('合計 5時間40分 ・ 中断2回 2時間35分 ・ 高木・山田')
    expect(tl.allDay.map(x => x.title)).toEqual(['棚卸 完了 ・ 10品目'])
  })

  it('期限つきのやることは「期限 m/d」。進行中・いつか・メモも終日（いつか・メモは数に入れない）', () => {
    const tl = buildDayTimeline({
      date: '2026-10-26', today: '2026-10-26',
      carry: [{ id: 'c', text: 'パッキン交換', deadline: '2026-10-28', assign: 'person', assigneeName: '佐藤' }],
      progress: [{ id: 'p', text: 'エアコンの修理', progress: 'waiting', waitNote: '見積もり' }],
      someday: [{ id: 's', text: 'メニュー表の作り直し' }],
      note: '20時から貸切',
    })
    expect(tl.allDay.map(x => [x.kind, x.title, x.sub])).toEqual([
      ['やること', 'パッキン交換', '期限 10/28 ・ 佐藤'],
      ['進行中', 'エアコンの修理', '待ち・見積もり'],
      ['いつか', 'メニュー表の作り直し', ''],
      ['メモ', '20時から貸切', ''],
    ])
    expect(tl.count).toBe(1)
  })
})
