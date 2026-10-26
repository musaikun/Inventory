// 進行中のやること（migration 0031・User決定 2026-10-23）
import { describe, it, expect } from 'vitest'
import { taskWriteCheck } from './taskWrite.js'
import { handleTaskNoteAdd, handleTaskNotesGet } from './storeHandler.js'

const ctxCan = () => true
const row = (o = {}) => ({ assign_mode: 'person', assignee_id: 'st1', created_by_id: 'owner', body: '製氷機の修理', task_date: '2026-10-25', due_time: null,
  done_at: null, deleted_at: null, kind: null, visibility: null, progress: 'doing', wait_note: null, deadline: null, steps_json: null, ...o })
const body = (o = {}) => ({ id: 't1', text: '製氷機の修理', date: '2026-10-25', dueTime: null, assign: 'person', assigneeId: 'st1', progress: 'doing', ...o })
const staff = (id) => ({ id, admin: false, ctx: { role: 'arbeit' } })

describe('進行中のやること: 書き込みの規則', () => {
  it('担当の人は、次に見る日・状態・待っているもの・手順を変えられる（文面は直せない）', () => {
    expect(taskWriteCheck(row(), body({ date: '2026-10-28', progress: 'waiting', waitNote: '見積もり', steps: [{ id: 's1', text: '業者に連絡', done: true }] }), staff('st1'), ctxCan).deny).toBeUndefined()
    expect(taskWriteCheck(row(), body({ text: '別の文面' }), staff('st1'), () => false).deny).toBeTruthy()
  })
  it('担当でない人は進み具合を変えられない', () => {
    expect(taskWriteCheck(row(), body({ progress: 'waiting' }), staff('st9'), () => false).deny).toMatch('進み具合')
  })
  it('ふつうのやることは、日付を直せるのは作った人と管理者だけ（前のまま）', () => {
    const r = row({ progress: null, assign_mode: 'anyone', assignee_id: null })
    expect(taskWriteCheck(r, body({ progress: null, assign: 'anyone', assigneeId: null, date: '2026-10-30' }), staff('st1'), () => false).deny).toBeTruthy()
  })
})

function noteDb(tasks = {}) {
  const notes = []
  const prepare = sql => {
    const s = sql.replace(/\s+/g, ' ').trim()
    const st = { args: [], bind(...a) { st.args = a; return st } }
    st.first = async () => (s.startsWith('SELECT deleted_at, visibility FROM tasks') ? tasks[st.args[0]] ?? null : null)
    st.all = async () => ({ results: notes.filter(n => n.task_id === st.args[1]).sort((a, b) => b.created_at.localeCompare(a.created_at)) })
    st.run = async () => {
      if (s.startsWith('INSERT INTO task_notes')) { const [id, shop, task, b, by, byId, at] = st.args; notes.push({ id, shop_code: shop, task_id: task, body: b, by_name: by, by_id: byId, created_at: at }) }
      if (s.startsWith('UPDATE tasks SET last_note')) Object.assign(tasks[st.args[3]], { last_note: st.args[0], last_note_by: st.args[1], last_note_at: st.args[2] })
      return { meta: { changes: 1 } }
    }
    return st
  }
  return { prepare, batch: async list => Promise.all(list.map(x => x.run())), notes, tasks }
}

describe('進行中のやること: 経過', () => {
  it('書くと時刻と人つきで残り、最後の経過がやることにも写る。新しい順に返す', async () => {
    const db = noteDb({ t1: { deleted_at: null, visibility: null } })
    const who = { id: 'st1', name: '佐藤' }
    await handleTaskNoteAdd(db, 'S1', 't1', { body: '業者に電話' }, who, { nowIso: '2026-10-23T05:10:00Z' })
    const r = await handleTaskNoteAdd(db, 'S1', 't1', { body: '見積もり3万円' }, who, { nowIso: '2026-10-25T05:10:00Z' })
    expect(r.note).toMatchObject({ body: '見積もり3万円', by: '佐藤', at: '2026-10-25T05:10:00Z' })
    expect(db.tasks.t1.last_note).toBe('見積もり3万円')
    const got = await handleTaskNotesGet(db, 'S1', 't1')
    expect(got.notes.map(n => n.body)).toEqual(['見積もり3万円', '業者に電話'])
  })
  it('空・消したもの・管理者だけのもの（管理者以外）は断る', async () => {
    const db = noteDb({ t1: { deleted_at: null, visibility: null }, t2: { deleted_at: '2026-10-01', visibility: null }, t3: { deleted_at: null, visibility: 'admins' } })
    const who = { id: 'st1', name: '佐藤' }
    expect((await handleTaskNoteAdd(db, 'S1', 't1', { body: '  ' }, who))._status).toBe(400)
    expect((await handleTaskNoteAdd(db, 'S1', 't2', { body: 'x' }, who))._status).toBe(404)
    expect((await handleTaskNoteAdd(db, 'S1', 't3', { body: 'x' }, who))._status).toBe(404)
    expect((await handleTaskNoteAdd(db, 'S1', 't3', { body: 'x' }, who, { admin: true })).ok).toBe(true)
  })
})

describe('備考（migration 0033・2026-10-26）', () => {
  it('担当の人も備考を書き足せる。担当でない人は断る', () => {
    const r = row({ progress: null, note: null })
    expect(taskWriteCheck(r, body({ progress: null, note: '業者の電話 03-xxxx' }), staff('st1'), () => false).deny).toBeUndefined()
    expect(taskWriteCheck(r, body({ progress: null, note: 'x' }), staff('st9'), () => false).deny).toMatch('備考')
  })
  it('期限つきのやることの期限を直せるのは、作った人と管理者だけ', () => {
    const r = row({ progress: null, deadline: '2026-10-28' })
    expect(taskWriteCheck(r, body({ progress: null, deadline: '2026-10-30' }), staff('st1'), () => false).deny).toBeTruthy()
    expect(taskWriteCheck(r, body({ progress: null, deadline: '2026-10-30' }), { id: 'owner', admin: true, ctx: { role: 'owner' } }, () => true).deny).toBeUndefined()
  })
})
