// カレンダーの「やること」（店で共有・User決定 2026-10-04）
import { describe, it, expect, beforeEach, vi } from 'vitest'

const saved = []
vi.mock('./useStore.js', () => ({
  loadTasksFromD1: vi.fn(async () => remote),
  saveTaskToD1: vi.fn(async t => { saved.push(t); return true }),
}))
vi.mock('./usePush.js', () => ({ ownPushEndpoint: vi.fn(async () => 'https://push.example/me') }))
let remote = []
let T

beforeEach(async () => {
  localStorage.clear(); vi.resetModules(); saved.length = 0; remote = []
  localStorage.setItem('_device_name', '高木')
  T = await import('./useTasks.js')
})
const flush = () => new Promise(r => setTimeout(r, 0))

describe('useTasks', () => {
  it('追加すると端末に残り、自分の端末名とIDを付けてサーバーへ送る（自分の通知先を添える）', async () => {
    const t = T.addTask('2026-10-04', '  冷凍庫の霜取り ')
    expect(t.text).toBe('冷凍庫の霜取り')
    expect(t.createdBy).toBe('高木')
    expect(T.tasksOn('2026-10-04').map(x => x.text)).toEqual(['冷凍庫の霜取り'])
    expect(T.isMyTask(t)).toBe(true)
    await flush()
    expect(saved[0]).toMatchObject({ id: t.id, text: '冷凍庫の霜取り', pushEndpoint: 'https://push.example/me' })
    expect(T.addTask('2026-10-04', '   ')).toBeNull()
  })

  it('完了・消すも同じ経路で送る。完了したものは消せない。消したものは一覧と点から外れる', async () => {
    const t = T.addTask('2026-10-05', '点検')
    expect(T.openTaskDates.value.has('2026-10-05')).toBe(true)
    T.toggleTask(t.id)
    expect(T.tasksOn('2026-10-05')[0].doneAt).toBeTruthy()
    expect(T.tasksOn('2026-10-05')[0].doneBy).toBe('高木')
    expect(T.openTaskDates.value.has('2026-10-05')).toBe(false)
    expect(T.removeTask(t.id)).toBeNull()                 // 完了したものは誰も消せない
    T.toggleTask(t.id)                                    // その日のうちなら本人が取り消せる
    T.removeTask(t.id)
    expect(T.tasksOn('2026-10-05')).toEqual([])
    await flush()
    expect(saved.at(-1).deletedAt).toBeTruthy()
  })

  it('初めて読んだときにあるものは新着にしない。その後に他の端末が追加したものが新着で、確認すると消える', async () => {
    const old = { id: 'a', date: '2026-10-04', text: '前から', createdBy: '山田', createdById: 'other', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
    remote = [old]
    await T.pullTasks()
    expect(T.newTasks.value).toEqual([])
    const later = new Date(Date.now() + 1000).toISOString()
    remote = [old, { id: 'b', date: '2026-10-06', text: '業者の点検', createdBy: '山田', createdById: 'other', createdAt: later, updatedAt: later }]
    await T.pullTasks()
    expect(T.newTasks.value.map(t => t.text)).toEqual(['業者の点検'])
    expect(T.isNewTask(T.tasksOn('2026-10-06')[0])).toBe(true)
    // 自分の追加は新着にしない
    T.addTask('2026-10-06', '自分の')
    expect(T.newTasks.value.map(t => t.text)).toEqual(['業者の点検'])
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.now() + 5000))
    T.markTasksSeen()
    vi.useRealTimers()
    expect(T.newTasks.value).toEqual([])
  })

  it('同じ1件は updatedAt の新しい方を残す', async () => {
    const t = T.addTask('2026-10-04', '元の内容')
    T.applyRemoteTasks([{ ...t, text: '古い変更', updatedAt: '2000-01-01T00:00:00Z' }])
    expect(T.tasksOn('2026-10-04')[0].text).toBe('元の内容')
    T.applyRemoteTasks([{ ...t, text: '新しい変更', updatedAt: '2999-01-01T00:00:00Z' }])
    expect(T.tasksOn('2026-10-04')[0].text).toBe('新しい変更')
  })

  it('今日の未完了の数（ナビのバッジ）。過ぎた日の終わっていないもの（期限切れ）も数える', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    T.addTask(localDateKey(), 'A'); const b = T.addTask(localDateKey(), 'B'); T.addTask('2000-01-01', '昔'); T.addTask('2999-01-01', '先')
    T.toggleTask(b.id)
    expect(T.todayOpenCount.value).toBe(2)
    expect(T.overdueTasks().map(t => t.text)).toEqual(['昔'])
  })

  it('時刻の順に並び、時刻なしは後ろ。直すと日付・時刻・文面が変わる', async () => {
    const a = T.addTask('2026-10-07', '時刻なし')
    T.addTask('2026-10-07', '午後', null, '15:00')
    T.addTask('2026-10-07', '朝', null, '09:00')
    T.addTask('2026-10-07', '壊れた時刻', null, '25:00')
    expect(T.tasksOn('2026-10-07').map(t => t.text)).toEqual(['朝', '午後', '時刻なし', '壊れた時刻'])
    T.editTask(a.id, { text: '時刻あり', dueTime: '08:00' })
    expect(T.tasksOn('2026-10-07')[0].text).toBe('時刻あり')
    T.editTask(a.id, { date: '2026-10-08' })
    expect(T.tasksOn('2026-10-08').map(t => t.text)).toEqual(['時刻あり'])
    expect(T.editTask(a.id, { text: '  ' })).toBeNull()
  })

  it('済み: 終えた日ごと・新しい日から。消したもの・まだのもの・範囲より前は出さない。期限から何日遅れたか', () => {
    const at = (d, hm) => new Date(`${d}T${hm}:00`).toISOString()
    T.applyRemoteTasks([
      { id: 'a', date: '2026-10-10', dueTime: '15:00', text: 'フィルター', doneAt: at('2026-10-10', '14:20'), updatedAt: '1' },
      { id: 'b', date: '2026-10-08', text: '油の交換', doneAt: at('2026-10-10', '11:05'), updatedAt: '1' },
      { id: 'c', date: '2026-10-09', text: '見積り', doneAt: at('2026-10-09', '09:12'), updatedAt: '1' },
      { id: 'd', date: '2026-10-09', text: '消した', doneAt: at('2026-10-09', '10:00'), deletedAt: 'x', updatedAt: '1' },
      { id: 'e', date: '2026-10-09', text: 'まだ', doneAt: null, updatedAt: '1' },
      { id: 'f', date: '2026-09-01', text: '古い', doneAt: at('2026-09-01', '10:00'), updatedAt: '1' },
      { id: 'g', date: '2026-10-09', dueTime: '10:00', text: '時刻過ぎ', doneAt: at('2026-10-09', '10:30'), updatedAt: '1' },
    ])
    const g = T.doneTaskGroups('2026-09-11')
    expect(g.map(x => x.date)).toEqual(['2026-10-10', '2026-10-09'])
    expect(g[0].items.map(x => x.id)).toEqual(['a', 'b'])
    expect(g[1].items.map(x => x.id)).toEqual(['g', 'c'])
    const L = id => T.doneLateness(g.flatMap(x => x.items).find(x => x.id === id))
    expect(L('a')).toEqual({ late: false, days: 0 })
    expect(L('b')).toEqual({ late: true, days: 2 })
    expect(L('c')).toEqual({ late: false, days: 0 })
    expect(L('g')).toEqual({ late: true, days: 0 })
  })

  it('いつか（日付なし）: 保存できて、期限切れ・その日・バッジには数えない。日付を入れればその日へ', async () => {
    const t = T.addTask('', 'メニュー表の作り直し', null, '10:00')
    expect(t).toMatchObject({ date: '', dueTime: null })
    expect(T.somedayTasks.value.map(x => x.id)).toEqual([t.id])
    expect(T.overdueTasks('2026-10-13')).toEqual([])
    expect(T.todayOpenCount.value).toBe(0)
    expect(T.openTaskCounts.value.size).toBe(0)
    T._reloadTasks()
    expect(T.somedayTasks.value).toHaveLength(1)                    // 端末に残る
    T.editTask(t.id, { date: '2026-10-20', dueTime: '09:00' })
    expect(T.somedayTasks.value).toHaveLength(0)
    expect(T.tasksOn('2026-10-20').map(x => x.dueTime)).toEqual(['09:00'])
    T.editTask(t.id, { date: '' })
    expect(T.somedayTasks.value[0].dueTime).toBeNull()
    expect(T.addTask('10/20', 'x')).toBeNull()
  })

  it('サーバーに無い「いつか」は、読み込みのときに送り直す（断られて捨てられた分を戻す）', async () => {
    const t = T.addTask('', 'メニュー表の作り直し')
    await flush(); saved.length = 0
    remote = []
    await T.pullTasks(); await flush()
    expect(saved.map(x => x.id)).toEqual([t.id])
    saved.length = 0
    remote = [{ ...t }]
    await T.pullTasks(); await flush()
    expect(saved).toEqual([])
  })

  it('その日のうちに取り消して付け直すと、元の完了時刻に戻る（2026-10-14）', async () => {
    const t = T.addTask('2026-10-05', '点検')
    T.toggleTask(t.id)
    const first = T.tasksOn('2026-10-05')[0].doneAt
    T.toggleTask(t.id)
    expect(T.tasksOn('2026-10-05')[0]).toMatchObject({ doneAt: null, prevDoneAt: first })
    await new Promise(r => setTimeout(r, 5))
    T.toggleTask(t.id)
    expect(T.tasksOn('2026-10-05')[0]).toMatchObject({ doneAt: first, prevDoneAt: null })
  })
})
