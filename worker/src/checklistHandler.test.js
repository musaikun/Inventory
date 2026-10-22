import { describe, it, expect } from 'vitest'
import { handleChecklistsGet, handleChecklistUpsert, handleChecklistMark, cleanItems, cleanDays, cleanTimes, WHOLE } from './checklistHandler.js'

// 使う SQL だけを解く小さな D1 の代わり
function fakeDb() {
  const state = { checklists: [], runs: [] }
  const norm = s => s.replace(/\s+/g, ' ').trim()
  const prepare = sql => {
    const s = norm(sql)
    let args = []
    const api = {
      bind(...a) { args = a; return api },
      async first() {
        if (s.startsWith('SELECT shop_code, updated_at')) return state.checklists.find(r => r.id === args[0]) ?? null
        if (s.startsWith('SELECT items_json, assign_mode')) return state.checklists.find(r => r.id === args[0] && r.shop_code === args[1]) ?? null
        if (s.startsWith('SELECT items_json, marks_json FROM checklist_runs')) {
          return state.runs.find(r => r.shop_code === args[0] && r.checklist_id === args[1] && r.run_date === args[2] && r.run_slot === args[3]) ?? null
        }
        throw new Error('unknown first: ' + s)
      },
      async all() {
        if (s.startsWith('SELECT * FROM checklists')) return { results: state.checklists.filter(r => r.shop_code === args[0] && (!r.deleted_at || r.updated_at >= args[1])) }
        if (s.startsWith('SELECT checklist_id')) return { results: state.runs.filter(r => r.shop_code === args[0] && r.run_date >= args[1]) }
        throw new Error('unknown all: ' + s)
      },
      async run() {
        if (s.startsWith('INSERT INTO checklists')) {
          const k = ['id', 'shop_code', 'name', 'items_json', 'repeat_mode', 'repeat_days', 'start_date', 'due_times', 'assign_mode',
            'assignee_id', 'assignee_name', 'paused', 'created_by', 'created_by_id', 'created_at', 'updated_at', 'deleted_at']
          const row = Object.fromEntries(k.map((x, i) => [x, args[i]]))
          const i = state.checklists.findIndex(r => r.id === row.id)
          if (i < 0) state.checklists.push(row)
          else if (state.checklists[i].updated_at <= row.updated_at) state.checklists[i] = { ...row, created_at: state.checklists[i].created_at }
          return { meta: { changes: 1 } }
        }
        if (s.startsWith('UPDATE checklist_runs')) {
          const r = state.runs.find(x => x.shop_code === args[2] && x.checklist_id === args[3] && x.run_date === args[4] && x.run_slot === args[5] && x.marks_json === args[6])
          if (!r) return { meta: { changes: 0 } }
          r.marks_json = args[0]; r.updated_at = args[1]
          return { meta: { changes: 1 } }
        }
        if (s.startsWith('INSERT INTO checklist_runs')) {
          if (state.runs.some(x => x.shop_code === args[0] && x.checklist_id === args[1] && x.run_date === args[2] && x.run_slot === args[3])) return { meta: { changes: 0 } }
          state.runs.push({ shop_code: args[0], checklist_id: args[1], run_date: args[2], run_slot: args[3], items_json: args[4], marks_json: args[5], updated_at: args[6] })
          return { meta: { changes: 1 } }
        }
        throw new Error('unknown run: ' + s)
      },
    }
    return api
  }
  return { prepare, state }
}

const base = {
  id: 'cl_close', name: '退店チェック', repeat: 'daily', startDate: '2026-10-01', dueTimes: ['22:00'],
  items: [{ id: 'i1', text: 'ガスの元栓' }, { id: 'i2', text: 'ショーケース電源' }],
}
const NOW = '2026-10-20T13:00:00.000Z'   // 日本時間 22:00

describe('チェック表', () => {
  it('項目と繰り返しの日をととのえる', () => {
    expect(cleanItems([{ id: 'a', text: ' x ' }, { id: 'a', text: 'y' }, { id: 'b', text: '' }, { id: 'c d', text: 'z' }])).toEqual([{ id: 'a', text: 'x' }])
    expect(cleanDays('weekly', [4, 1, 1, 9])).toBe('1,4')
    expect(cleanDays('weekly', [])).toBeNull()
    expect(cleanDays('monthly', 31)).toBe('31')
    expect(cleanDays('monthly', 0)).toBeNull()
    expect(cleanDays('monthly', ['15', 1, 'L', 40])).toBe('1,15,L')
    expect(cleanDays('monthly', 'L')).toBe('L')
    expect(cleanDays('daily', [1])).toBeNull()
    expect(cleanTimes(['21:00', '10:00', '10:00', '25:00', ''])).toBe('10:00,21:00')
    expect(cleanTimes([])).toBeNull()
  })

  it('項目なしのルーティン: 全体を1つの印で済ませる', async () => {
    const db = fakeDb()
    await handleChecklistUpsert(db, 'S1', { ...base, id: 'r1', name: '発注書の提出', items: [], repeat: 'monthly', repeatDays: [1], dueTimes: [] })
    const who = { id: 'st1', name: '佐藤' }
    expect((await handleChecklistMark(db, 'S1', 'r1', '2026-10-20', { itemId: 'i1', state: 'done' }, who, { nowIso: NOW }))._status).toBe(404)
    const r = await handleChecklistMark(db, 'S1', 'r1', '2026-10-20', { itemId: WHOLE, state: 'done' }, who, { nowIso: NOW })
    expect(r.run.marks[WHOLE]).toMatchObject({ s: 'done', by: '佐藤' })
    expect(r.run.items).toEqual([])
  })

  it('1日に何回も: 回ごとに別の記録', async () => {
    const db = fakeDb()
    await handleChecklistUpsert(db, 'S1', { ...base, dueTimes: ['10:00', '15:00'] })
    const who = { id: 'st1', name: '佐藤' }
    const a = await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { slot: '10:00', itemId: 'i1', state: 'done' }, who, { nowIso: NOW })
    const b = await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { slot: '15:00', itemId: 'i2', state: 'done' }, who, { nowIso: NOW })
    expect(a.run).toMatchObject({ slot: '10:00', marks: { i1: { s: 'done' } } })
    expect(b.run.marks.i1).toBeUndefined()
    expect(db.state.runs).toHaveLength(2)
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { slot: '9:00', itemId: 'i1', state: 'done' }, who, { nowIso: NOW }))._status).toBe(400)
    const got = await handleChecklistsGet(db, 'S1', 120)
    expect(got.runs.map(r => r.slot).sort()).toEqual(['10:00', '15:00'])
  })

  it('作る・読む。名前や項目が無ければ断る', async () => {
    const db = fakeDb()
    expect((await handleChecklistUpsert(db, 'S1', { ...base, name: '' }))._status).toBe(400)
    expect((await handleChecklistUpsert(db, 'S1', { ...base, repeat: 'weekly' }))._status).toBe(400)
    const r = await handleChecklistUpsert(db, 'S1', base, { id: 'owner', name: '店長' })
    expect(r).toMatchObject({ ok: true, created: true })
    const got = await handleChecklistsGet(db, 'S1', 120)
    expect(got.checklists[0]).toMatchObject({ name: '退店チェック', repeat: 'daily', dueTimes: ['22:00'], createdBy: '店長', items: base.items })
    // 他店舗の ID は見つからない扱い
    expect((await handleChecklistUpsert(db, 'S2', base))._status).toBe(404)
  })

  it('✓は最初の1回で項目を写し、あとで表を直してもその日の記録は崩れない', async () => {
    const db = fakeDb()
    await handleChecklistUpsert(db, 'S1', { ...base, updatedAt: '2026-10-01T00:00:00Z' })
    const who = { id: 'st1', name: '佐藤' }
    const r = await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: 'done' }, who, { nowIso: NOW })
    expect(r.run.marks.i1).toMatchObject({ s: 'done', by: '佐藤', byId: 'st1', at: NOW })
    await handleChecklistUpsert(db, 'S1', { ...base, items: [{ id: 'i9', text: '新しい項目' }], updatedAt: '2026-10-20T13:01:00Z' })
    const r2 = await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i2', state: 'skip', reason: '故障中' }, who, { nowIso: NOW })
    expect(r2.run.items.map(x => x.id)).toEqual(['i1', 'i2'])
    expect(r2.run.marks.i2).toMatchObject({ s: 'skip', reason: '故障中' })
  })

  it('先の日には付けられない・担当の人がいれば担当と管理者だけ', async () => {
    const db = fakeDb()
    await handleChecklistUpsert(db, 'S1', { ...base, assign: 'person', assigneeId: 'st2', assigneeName: '山田' })
    const opt = { nowIso: NOW }
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-21', { itemId: 'i1', state: 'done' }, { id: 'st2', name: '山田' }, opt))._status).toBe(403)
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: 'done' }, { id: 'st1', name: '佐藤' }, opt))._status).toBe(403)
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: 'done' }, { id: 'st2', name: '山田' }, opt)).ok).toBe(true)
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i2', state: 'done' }, { id: 'owner', name: '店長' }, { ...opt, admin: true })).ok).toBe(true)
  })

  it('外せるのは付けた人がその日のうち（管理者はいつでも）', async () => {
    const db = fakeDb()
    await handleChecklistUpsert(db, 'S1', base)
    const sato = { id: 'st1', name: '佐藤' }
    await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: 'done' }, sato, { nowIso: NOW })
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: null }, { id: 'st3', name: '鈴木' }, { nowIso: NOW }))._status).toBe(403)
    const nextDay = '2026-10-21T01:00:00.000Z'
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: null }, sato, { nowIso: nextDay }))._status).toBe(403)
    const r = await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: null }, sato, { nowIso: NOW })
    expect(r.run.marks.i1).toBeUndefined()
  })

  it('同じ印の送り直しは時刻を変えない・無い項目は断る', async () => {
    const db = fakeDb()
    await handleChecklistUpsert(db, 'S1', base)
    const sato = { id: 'st1', name: '佐藤' }
    await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: 'done' }, sato, { nowIso: NOW })
    const r = await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'i1', state: 'done' }, sato, { nowIso: '2026-10-20T13:30:00.000Z' })
    expect(r.run.marks.i1.at).toBe(NOW)
    expect((await handleChecklistMark(db, 'S1', 'cl_close', '2026-10-20', { itemId: 'zz', state: 'done' }, sato, { nowIso: NOW }))._status).toBe(404)
  })
})
