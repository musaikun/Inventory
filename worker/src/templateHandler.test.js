// やることのお気に入り（ひな形・migration 0035・2026-11-05）
import { describe, it, expect } from 'vitest'
import { handleTemplatesGet, handleTemplateUpsert, cleanTemplateData, TEMPLATES_MAX } from './templateHandler.js'

function fakeDb() {
  const rows = []
  const norm = s => s.replace(/\s+/g, ' ').trim()
  const prepare = sql => {
    const s = norm(sql)
    let args = []
    const api = {
      bind(...a) { args = a; return api },
      async first() {
        if (s.startsWith('SELECT shop_code, updated_at')) return rows.find(r => r.id === args[0]) ?? null
        if (s.startsWith('SELECT COUNT(*)')) return { n: rows.filter(r => r.shop_code === args[0] && !r.deleted_at).length }
        throw new Error('unknown first: ' + s)
      },
      async all() {
        if (s.startsWith('SELECT * FROM task_templates')) return { results: rows.filter(r => r.shop_code === args[0] && (!r.deleted_at || r.updated_at >= args[1])).sort((a, b) => a.sort - b.sort) }
        throw new Error('unknown all: ' + s)
      },
      async run() {
        if (s.startsWith('INSERT INTO task_templates')) {
          const k = ['id', 'shop_code', 'kind', 'name', 'data_json', 'sort', 'created_by', 'created_by_id', 'created_at', 'updated_at', 'deleted_at']
          const row = Object.fromEntries(k.map((x, i) => [x, args[i]]))
          const i = rows.findIndex(r => r.id === row.id)
          if (i < 0) rows.push(row)
          else if (rows[i].shop_code === row.shop_code && rows[i].updated_at <= row.updated_at) rows[i] = { ...row, created_at: rows[i].created_at }
          return { meta: { changes: 1 } }
        }
        throw new Error('unknown run: ' + s)
      },
    }
    return api
  }
  return { prepare, rows }
}
const sato = { id: 'st1', name: '佐藤' }, yamada = { id: 'st2', name: '山田' }
const t = (o = {}) => ({ id: 'tp1', kind: 'checklist', name: '閉店チェック', data: { items: [{ id: 'i1', text: 'ガスの元栓' }], repeat: 'daily', dueTimes: ['22:30'] }, ...o })

describe('お気に入り', () => {
  it('種類に要らない中身は捨て、日付は持たない', () => {
    expect(cleanTemplateData('checklist', { items: [{ id: 'i1', text: 'x' }], repeat: 'weekly', repeatDays: [1, 5], dueTimes: ['9:00', '22:30'], note: 'no', date: '2026-11-05' }))
      .toEqual({ items: [{ id: 'i1', text: 'x' }], repeat: 'weekly', repeatDays: '1,5', dueTimes: ['22:30'] })
    expect(cleanTemplateData('routine', { repeat: 'none' }).repeat).toBe('daily')
    expect(cleanTemplateData('task', { dueTime: '15:00', note: '油は2缶', items: [{ id: 'i1', text: 'x' }] })).toEqual({ dueTime: '15:00', note: '油は2缶' })
    expect(cleanTemplateData('task', { assign: { mode: 'person', id: 'st1', name: '佐藤' } }).assign).toEqual({ mode: 'person', id: 'st1', name: '佐藤' })
  })

  it('足す・読む・他店からは見えない', async () => {
    const db = fakeDb()
    const r = await handleTemplateUpsert(db, 'S1', t(), sato, { admin: false })
    expect(r).toMatchObject({ ok: true, created: true, template: { name: '閉店チェック', createdBy: '佐藤' } })
    expect((await handleTemplatesGet(db, 'S1')).templates).toHaveLength(1)
    expect((await handleTemplatesGet(db, 'S2')).templates).toHaveLength(0)
    expect((await handleTemplateUpsert(db, 'S2', t(), sato))._status).toBe(404)
    expect((await handleTemplateUpsert(db, 'S1', t({ name: '' }), sato))._status).toBe(400)
  })

  it('直す・外すのは作った人と管理者だけ', async () => {
    const db = fakeDb()
    await handleTemplateUpsert(db, 'S1', t({ updatedAt: '2026-11-05T00:00:00Z' }), sato, { admin: false })
    expect((await handleTemplateUpsert(db, 'S1', t({ name: 'x', updatedAt: '2026-11-05T00:01:00Z' }), yamada, { admin: false }))._status).toBe(403)
    expect((await handleTemplateUpsert(db, 'S1', t({ deletedAt: '2026-11-05T00:02:00Z', updatedAt: '2026-11-05T00:02:00Z' }), sato, { admin: false })).ok).toBe(true)
    expect(db.rows[0].deleted_at).toBeTruthy()
  })

  it(`1店 ${TEMPLATES_MAX}件まで`, async () => {
    const db = fakeDb()
    for (let i = 0; i < TEMPLATES_MAX; i++) await handleTemplateUpsert(db, 'S1', t({ id: `tp${i}` }), sato)
    expect((await handleTemplateUpsert(db, 'S1', t({ id: 'over' }), sato))._status).toBe(409)
  })
})
