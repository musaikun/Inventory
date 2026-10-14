// やることの権限（User決定 2026-10-14）。サーバー（worker/src/taskRights.js）と同じ中身であることと、規則そのもの。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as R from './taskRights.js'

const body = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').split('\n').filter(l => !l.includes('と同じ中身')).join('\n')

describe('taskRights', () => {
  it('サーバーと同じ中身', () => {
    expect(body('./taskRights.js')).toBe(body('../../../worker/src/taskRights.js'))
  })

  const day = iso => iso.slice(0, 10)
  const staff = { id: 's1', admin: false, canCreate: true }
  const other = { id: 's2', admin: false, canCreate: true }
  const arbeit = { id: 's3', admin: false, canCreate: false }
  const admin = { id: 'owner', admin: true, canCreate: true }

  it('直す・消すは未完了の間だけ、作った人（作る権限あり）と管理者', () => {
    const t = { createdById: 's1', doneAt: null }
    expect(R.canEdit(t, staff)).toBe(true)
    expect(R.canEdit(t, other)).toBe(false)
    expect(R.canEdit({ ...t, createdById: 's3' }, arbeit)).toBe(false)
    expect(R.canRemove(t, admin)).toBe(true)
    const done = { ...t, doneAt: '2026-10-14T01:00:00Z' }
    expect(R.canEdit(done, staff)).toBe(false)
    expect(R.canRemove(done, admin)).toBe(false)   // 完了したものは誰も消せない
  })

  it('完了は担当の人（管理者は代わりに）。取り消しは本人がその日のうち、ほかは管理者', () => {
    const t = { assign: 'person', assigneeId: 's1', doneAt: null }
    expect(R.canComplete(t, staff)).toBe(true)
    expect(R.canComplete(t, other)).toBe(false)
    expect(R.canComplete(t, admin)).toBe(true)
    expect(R.canComplete({ assign: 'anyone' }, arbeit)).toBe(true)
    const done = { ...t, doneAt: '2026-10-14T01:00:00Z', doneById: 's1' }
    expect(R.canUndo(done, staff, '2026-10-14', day)).toBe(true)
    expect(R.canUndo(done, staff, '2026-10-15', day)).toBe(false)
    expect(R.canUndo(done, other, '2026-10-14', day)).toBe(false)
    expect(R.canUndo(done, admin, '2026-10-20', day)).toBe(true)
  })

  it('その日のうちに取り消した本人の付け直しは元の時刻。管理者の差し戻しは元の時刻を残さない', () => {
    const done = { doneAt: '2026-10-14T01:00:00Z', doneById: 's1' }
    const kept = { ...R.undoKeep(done, staff), doneAt: null }
    expect(R.redoDoneAt(kept, staff, '2026-10-14T05:00:00Z', '2026-10-14', day)).toBe('2026-10-14T01:00:00Z')
    expect(R.redoDoneAt(kept, other, '2026-10-14T05:00:00Z', '2026-10-14', day)).toBe('2026-10-14T05:00:00Z')
    expect(R.redoDoneAt(kept, staff, '2026-10-15T05:00:00Z', '2026-10-15', day)).toBe('2026-10-15T05:00:00Z')
    expect(R.undoKeep(done, admin)).toEqual({ prevDoneAt: null, prevDoneById: null })
  })
})
