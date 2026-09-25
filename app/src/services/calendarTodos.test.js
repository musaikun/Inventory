import { describe, it, expect } from 'vitest'
import { calendarTodos } from './calendarTodos.js'

const TODAY = '2026-09-20'   // 日曜
const sched = [{ id: 'a', name: '青果', days: [0, 3], deadline: '15:00' }, { id: 'b', name: '肉', days: [2], deadline: '' }]

describe('calendarTodos', () => {
  it('今日が発注日のスケジュールだけ出す。今日の発注があれば済み', () => {
    let t = calendarTodos({ today: TODAY, orderSchedules: sched })
    expect(t).toEqual([expect.objectContaining({ kind: 'order', label: '青果の発注日', sub: '締切 15:00', done: false })])
    t = calendarTodos({ today: TODAY, orderSchedules: sched, orders: [{ id: 'o', date: TODAY, lines: [] }] })
    expect(t[0]).toMatchObject({ kind: 'order', done: true })
  })

  it('入庫が未記録の発注（30日以内・今日まで）を古い順に出す。入庫に紐付けば消える', () => {
    const orders = [
      { id: 'o1', date: '2026-09-18', supplier: '肉屋', lines: [{}, {}] },
      { id: 'o2', date: '2026-09-10', lines: [{}] },
      { id: 'o3', date: '2026-08-01', lines: [{}] },   // 30日より前
    ]
    const t = calendarTodos({ today: TODAY, orders, movements: [{ orderId: 'o2' }] })
    expect(t.map(x => x.id)).toEqual(['delivery:o1'])
    expect(t[0]).toMatchObject({ label: '9/18 の発注の入庫が未記録', date: '2026-09-18' })
    expect(t[0].sub).toContain('肉屋・2品目')
  })

  it('棚卸はいつもの間隔（直近の平均）を過ぎたら出す。今日やっていれば済み。2回未満は出さない', () => {
    const keys = ['2026-08-23', '2026-08-30', '2026-09-06']   // 7日ごと → 前回から14日
    expect(calendarTodos({ today: TODAY, stockKeys: keys })[0]).toMatchObject({
      kind: 'stock', done: false, sub: '前回（9/6）から14日。いつもは約7日ごと',
    })
    expect(calendarTodos({ today: '2026-09-10', stockKeys: keys })).toEqual([])   // まだ4日
    expect(calendarTodos({ today: TODAY, stockKeys: [...keys, TODAY] })[0]).toMatchObject({ kind: 'stock', done: true })
    expect(calendarTodos({ today: TODAY, stockKeys: ['2026-09-01'] })).toEqual([])
  })
})
