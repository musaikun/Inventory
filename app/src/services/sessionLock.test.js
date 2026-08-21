// 削除の安全条件を共有化したことの回帰。
// ホームと履歴カレンダーページで同じ判定・同じ警告文になることを保証する。
import { describe, it, expect } from 'vitest'
import { isSessionLocked, deleteConfirmMessage, CORRECTION_DAYS } from './sessionLock.js'

const DAY = 86400_000
const iso = ms => new Date(ms).toISOString()

describe('isSessionLocked', () => {
  it('スナップショットが恒久ロック済みならロック', () => {
    const s = { id: 'a', endedAt: iso(Date.now()) }
    expect(isSessionLocked(s, { snapshotLocked: true })).toBe(true)
  })

  it('未完了（endedAt なし）はロックしない', () => {
    expect(isSessionLocked({ id: 'a' }, {})).toBe(false)
  })

  it('訂正可能期間を過ぎるとロック', () => {
    const old = { id: 'a', endedAt: iso(Date.now() - (CORRECTION_DAYS * DAY + 1000)) }
    const fresh = { id: 'a', endedAt: iso(Date.now() - DAY) }
    expect(isSessionLocked(old, {})).toBe(true)
    expect(isSessionLocked(fresh, {})).toBe(false)
  })

  it('後から始まった棚卸があるとロック（自分自身は除く）', () => {
    const target = { id: 'a', endedAt: iso(Date.now() - DAY) }
    const later  = { id: 'b', startedAt: iso(Date.now() - DAY / 2) }
    const before = { id: 'c', startedAt: iso(Date.now() - 2 * DAY) }
    expect(isSessionLocked(target, { completedSessions: [target, before] })).toBe(false)
    expect(isSessionLocked(target, { completedSessions: [target, before, later] })).toBe(true)
  })
})

describe('deleteConfirmMessage', () => {
  it('進行中は入力中データの喪失を伝える', () => {
    expect(deleteConfirmMessage({ status: 'active' })).toContain('入力中のデータも失われます')
  })
  it('ロック済みは確定済みであることを伝える', () => {
    expect(deleteConfirmMessage({ status: 'completed' }, true)).toContain('編集ロック')
  })
  it('通常は取り消せないことを伝える', () => {
    const msg = deleteConfirmMessage({ status: 'completed' }, false)
    expect(msg).toContain('取り消せません')
    expect(msg).not.toContain('編集ロック')
  })
})
