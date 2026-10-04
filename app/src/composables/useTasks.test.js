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

  it('完了・消すも同じ経路で送る。消したものは一覧と点から外れる', async () => {
    const t = T.addTask('2026-10-05', '点検')
    expect(T.openTaskDates.value.has('2026-10-05')).toBe(true)
    T.toggleTask(t.id)
    expect(T.tasksOn('2026-10-05')[0].doneAt).toBeTruthy()
    expect(T.tasksOn('2026-10-05')[0].doneBy).toBe('高木')
    expect(T.openTaskDates.value.has('2026-10-05')).toBe(false)
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

  it('今日の未完了の数（ナビのバッジ）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    T.addTask(localDateKey(), 'A'); const b = T.addTask(localDateKey(), 'B'); T.addTask('2000-01-01', '昔')
    T.toggleTask(b.id)
    expect(T.todayOpenCount.value).toBe(1)
  })
})
