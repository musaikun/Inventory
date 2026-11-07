// 日誌の予定ボード（migration 0036・2026-11-05）: 終わりの時刻と種類
import { describe, it, expect } from 'vitest'
import { taskWriteCheck } from './taskWrite.js'

const ctxCan = () => true
const row = (o = {}) => ({ assign_mode: 'person', assignee_id: 'st1', created_by_id: 'owner', body: 'ランチの仕込み', task_date: '2026-11-05', due_time: '09:00',
  end_time: '10:30', category: 'prep', done_at: null, deleted_at: null, kind: null, visibility: null, progress: null, wait_note: null, deadline: null, steps_json: null, note: null, ...o })
const body = (o = {}) => ({ id: 't1', text: 'ランチの仕込み', date: '2026-11-05', dueTime: '09:00', assign: 'person', assigneeId: 'st1', ...o })
const staff = id => ({ id, admin: false, ctx: { role: 'arbeit' } })

describe('予定ボード: 書き込みの規則', () => {
  it('終わりの時刻・種類を変えるのは「直す」（担当の人だけでは直せない）', () => {
    expect(taskWriteCheck(row(), body({ endTime: '11:00', category: 'prep' }), staff('st1'), ctxCan).deny).toBeTruthy()
    expect(taskWriteCheck(row(), body({ endTime: '10:30', category: 'clean' }), staff('st1'), ctxCan).deny).toBeTruthy()
    expect(taskWriteCheck(row(), body({ endTime: '11:00' }), staff('owner'), ctxCan).deny).toBeUndefined()
  })
  it('終わりの時刻・種類を知らない古い端末が完了だけ送っても、断らない', () => {
    const r = taskWriteCheck(row(), body({ doneAt: '2026-11-05T01:00:00Z' }), staff('st1'), ctxCan)
    expect(r.deny).toBeUndefined()
  })
})
