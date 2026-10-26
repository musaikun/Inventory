// 止まっている進行中のやることを知らせる（User決定 2026-10-26）
import { describe, it, expect } from 'vitest'
import { remindStaleProgress } from './pushHandler.js'

const DAY = 86400_000
const T0 = Date.parse('2026-10-26T00:00:00Z')
const iso = ms => new Date(ms).toISOString()

function fakeEnv(tasks) {
  const prepare = sql => {
    const s = sql.replace(/\s+/g, ' ').trim()
    const st = { args: [], bind(...a) { st.args = a; return st } }
    st.all = async () => {
      if (s.startsWith('SELECT id, shop_code, body, progress')) {
        const since = st.args[0]
        return { results: tasks.filter(t => t.progress && !t.done_at && !t.deleted_at && [t.created_at, t.updated_at || '', t.last_note_at || ''].sort().pop() <= since) }
      }
      return { results: [] }
    }
    st.first = async () => null
    st.run = async () => { if (s.startsWith('UPDATE tasks SET reminded_at')) tasks.find(t => t.id === st.args[1]).reminded_at = st.args[0]; return { meta: { changes: 1 } } }
    return st
  }
  return { DB: { prepare } }
}
const task = (o = {}) => ({ id: 't1', shop_code: 'S1', body: '製氷機の修理', progress: 'doing', assign_mode: 'person', assignee_id: 'st1', created_by_id: 'owner', created_at: iso(T0), updated_at: iso(T0), last_note_at: null, reminded_at: null, ...o })

describe('止まっている進行中', () => {
  it('3日で1回、5日でもう1回（管理者へ）。それ以上は送らない。動きがあれば数え直す', async () => {
    const tasks = [task()]
    const env = fakeEnv(tasks)
    expect(await remindStaleProgress(env, T0 + 2 * DAY)).toBe(0)
    expect(await remindStaleProgress(env, T0 + 3 * DAY)).toBe(1)
    expect(await remindStaleProgress(env, T0 + 4 * DAY)).toBe(0)
    expect(await remindStaleProgress(env, T0 + 5 * DAY)).toBe(1)
    expect(await remindStaleProgress(env, T0 + 9 * DAY)).toBe(0)
    tasks[0].last_note_at = iso(T0 + 9 * DAY)      // 経過を書いた
    expect(await remindStaleProgress(env, T0 + 11 * DAY)).toBe(0)
    expect(await remindStaleProgress(env, T0 + 12 * DAY)).toBe(1)
  })
  it('「待ち」は 5日・8日', async () => {
    const env = fakeEnv([task({ progress: 'waiting' })])
    expect(await remindStaleProgress(env, T0 + 4 * DAY)).toBe(0)
    expect(await remindStaleProgress(env, T0 + 5 * DAY)).toBe(1)
    expect(await remindStaleProgress(env, T0 + 7 * DAY)).toBe(0)
    expect(await remindStaleProgress(env, T0 + 8 * DAY)).toBe(1)
  })
})
