// 申し送り（migration 0032・User決定 2026-10-25）
import { describe, it, expect } from 'vitest'
import { handleHandoffsGet, handleHandoffAdd, handleHandoffRead, handleHandoffTask, handleHandoffDelete } from './handoffHandler.js'

function fakeDb() {
  const rows = []
  const find = (code, id) => rows.find(r => r.shop_code === code && r.id === id) ?? null
  const prepare = sql => {
    const s = sql.replace(/\s+/g, ' ').trim()
    const st = { args: [], bind(...a) { st.args = a; return st } }
    st.first = async () => (s.startsWith('SELECT * FROM handoffs WHERE shop_code = ? AND id = ?') ? (find(...st.args) && { ...find(...st.args) }) : null)
    st.all = async () => ({ results: rows.filter(r => r.shop_code === st.args[0] && r.created_at >= st.args[1] && !r.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at)) })
    st.run = async () => {
      const a = st.args
      if (s.startsWith('INSERT INTO handoffs')) {
        if (find(a[1], a[0])) return { meta: { changes: 0 } }
        rows.push({ id: a[0], shop_code: a[1], kind: a[2], body: a[3], by_name: a[4], by_id: a[5], to_id: a[6], to_name: a[7], task_id: a[8], reads_json: '[]', created_at: a[9], deleted_at: null })
        return { meta: { changes: 1 } }
      }
      if (s.startsWith('UPDATE handoffs SET reads_json')) {
        const r = find(a[1], a[2])
        if (!r || r.reads_json !== a[3]) return { meta: { changes: 0 } }
        r.reads_json = a[0]; return { meta: { changes: 1 } }
      }
      if (s.startsWith('UPDATE handoffs SET task_id = NULL')) { const r = find(a[0], a[1]); if (r && r.task_id === a[2]) { r.task_id = null; return { meta: { changes: 1 } } } return { meta: { changes: 0 } } }
      if (s.startsWith('UPDATE handoffs SET task_id')) { const r = find(a[1], a[2]); if (r && !r.task_id) { r.task_id = a[0]; return { meta: { changes: 1 } } } return { meta: { changes: 0 } } }
      if (s.startsWith('UPDATE handoffs SET deleted_at')) { find(a[1], a[2]).deleted_at = a[0]; return { meta: { changes: 1 } } }
      return { meta: { changes: 0 } }
    }
    return st
  }
  return { prepare, rows }
}
const yamada = { id: 'st-y', name: '山田' }
const sato = { id: 'st-s', name: '佐藤' }

describe('申し送り', () => {
  it('📣 伝える: 書くと時刻と人つき。読んだ人が「確認」を押すと、誰が読んだか残る（同じ人は1回）', async () => {
    const db = fakeDb()
    const r = await handleHandoffAdd(db, 'S1', { id: 'h1', kind: 'tell', body: 'トマトの入荷が明日に' }, yamada, { nowIso: '2026-10-24T13:40:00Z' })
    expect(r.handoff).toMatchObject({ id: 'h1', kind: 'tell', by: '山田', byId: 'st-y', toId: null, reads: [], createdAt: '2026-10-24T13:40:00Z' })
    await handleHandoffRead(db, 'S1', 'h1', sato, { nowIso: '2026-10-25T00:10:00Z' })
    const again = await handleHandoffRead(db, 'S1', 'h1', sato, { nowIso: '2026-10-25T00:20:00Z' })
    expect(again.handoff.reads).toEqual([{ id: 'st-s', name: '佐藤', at: '2026-10-25T00:10:00Z' }])
    // 同じ id の再送は1件
    await handleHandoffAdd(db, 'S1', { id: 'h1', kind: 'tell', body: '別の文' }, yamada)
    expect(db.rows).toHaveLength(1)
  })

  it('🙏 頼む: 相手とやることの id を付けて残す。伝えたことも後から「やることにする」（1つだけ）', async () => {
    const db = fakeDb()
    const r = await handleHandoffAdd(db, 'S1', { kind: 'ask', body: '製氷機のフィルター交換', toId: 'st-s', toName: '佐藤', taskId: 't1' }, yamada)
    expect(r.handoff).toMatchObject({ kind: 'ask', toId: 'st-s', toName: '佐藤', taskId: 't1' })
    await handleHandoffAdd(db, 'S1', { id: 'h2', kind: 'tell', body: 'パッキンが浮いてる', toId: 'st-s' }, yamada)
    expect(db.rows[1].to_id).toBeNull()                       // 伝えるだけのものに相手は付けない
    expect((await handleHandoffTask(db, 'S1', 'h2', { taskId: 't9' })).handoff.taskId).toBe('t9')
    expect((await handleHandoffTask(db, 'S1', 'h2', { taskId: 't10' })).handoff.taskId).toBe('t9')
    // 取り消す: 付いている id が同じときだけ外れ、外れたらまた付けられる
    expect((await handleHandoffTask(db, 'S1', 'h2', { taskId: 't10', clear: true })).handoff.taskId).toBe('t9')
    expect((await handleHandoffTask(db, 'S1', 'h2', { taskId: 't9', clear: true })).handoff.taskId).toBeNull()
    expect((await handleHandoffTask(db, 'S1', 'h2', { taskId: 't11' })).handoff.taskId).toBe('t11')
  })

  it('空・種類なしは断る。消せるのは書いた人と管理者。消したものは出さない。直近の日数だけ返す', async () => {
    const db = fakeDb()
    expect((await handleHandoffAdd(db, 'S1', { kind: 'tell', body: '  ' }, yamada))._status).toBe(400)
    expect((await handleHandoffAdd(db, 'S1', { kind: 'memo', body: 'x' }, yamada))._status).toBe(400)
    await handleHandoffAdd(db, 'S1', { id: 'h1', kind: 'tell', body: '古い' }, yamada, { nowIso: '2026-09-01T00:00:00Z' })
    await handleHandoffAdd(db, 'S1', { id: 'h2', kind: 'tell', body: '新しい' }, yamada, { nowIso: '2026-10-24T00:00:00Z' })
    await handleHandoffAdd(db, 'S1', { id: 'h3', kind: 'tell', body: '消す' }, yamada, { nowIso: '2026-10-24T01:00:00Z' })
    expect((await handleHandoffDelete(db, 'S1', 'h3', sato))._status).toBe(403)
    expect((await handleHandoffDelete(db, 'S1', 'h3', yamada)).ok).toBe(true)
    const got = await handleHandoffsGet(db, 'S1', 14, { nowMs: Date.parse('2026-10-25T00:00:00Z') })
    expect(got.handoffs.map(h => h.body)).toEqual(['新しい'])
    expect((await handleHandoffRead(db, 'S1', 'h3', sato))._status).toBe(404)
  })
})
