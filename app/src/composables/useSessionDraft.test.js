// セッション単位の在庫下書き（useSessionDraft）。App.vue から切り出したときの挙動を固定する。
import { describe, it, expect, beforeEach } from 'vitest'
import { useInventory, applyRemoteUpdate, resetLocalData as resetInventory } from './useInventory.js'
import { useSync, clearAuditLog, mergeAuditLog } from './useSync.js'
import { useHistory, resetLocalData as resetHistory } from './useHistory.js'
import { useActiveTimer } from './useActiveTimer.js'
import { useSessionDraft } from './useSessionDraft.js'

const { inventory } = useInventory()
const { auditLog } = useSync()
const { applyRemoteHistory } = useHistory()
const activeTimer = useActiveTimer()
const { saveDraft, restoreDraft, restoreDraftAudit, clearDraft } = useSessionDraft({ activeTimer })

const audit = (id, item, ts) => ({ id, ingredient: item, qty: 1, timestamp: ts })

describe('useSessionDraft', () => {
  beforeEach(() => {
    localStorage.clear()
    resetInventory()
    resetHistory()
    clearAuditLog()
    activeTimer.start()
  })

  it('保存して消してから戻すと、数量・稼働時間・変更履歴が戻る', () => {
    applyRemoteUpdate('トマト', 3, '箱', '山田', 1000)
    mergeAuditLog([audit('a1', 'トマト', 1000)])
    activeTimer.resume(90_000)
    saveDraft('s1')

    resetInventory(); clearAuditLog(); activeTimer.start()
    restoreDraft('s1')
    expect(inventory['トマト']).toMatchObject({ qty: 3, unit: '箱', enteredBy: '山田', updatedAt: 1000 })
    expect(activeTimer.activeMs.value).toBe(90_000)
    expect(auditLog.map(e => e.id)).toEqual(['a1'])
  })

  it('在庫も変更履歴も空なら書かない', () => {
    saveDraft('s1')
    expect(localStorage.getItem('inv_draft_s1')).toBeNull()
  })

  it('セッションIDが無ければ何もしない', () => {
    applyRemoteUpdate('トマト', 3, '箱')
    saveDraft(null)
    expect(Object.keys(localStorage).filter(k => k.startsWith('inv_draft_'))).toEqual([])
  })

  it('旧形式（在庫をそのまま並べた下書き）も戻せる', () => {
    localStorage.setItem('inv_draft_s1', JSON.stringify({ 'レタス': { qty: 2, unit: '玉', updatedAt: 5 } }))
    restoreDraft('s1')
    expect(inventory['レタス']).toMatchObject({ qty: 2, unit: '玉' })
  })

  it('下書きが無い（完了済みを開き直した）ときは、完了時のスナップショットから戻す', () => {
    applyRemoteHistory([{
      sessionId: 's1', date: '2026-10-12', savedAt: 7, activeMs: 60_000,
      items: [{ item: 'トマト', qty: 4, unit: '箱' }, { item: 'なす', qty: null }],
      participants: [{ name: '佐藤', items: [{ item: 'トマト', at: 6 }] }],
      auditLog: [audit('a9', 'トマト', 6)],
    }])
    restoreDraft('s1')
    expect(inventory['トマト']).toMatchObject({ qty: 4, unit: '箱', enteredBy: '佐藤', updatedAt: 6 })
    expect(inventory['なす']).toBeUndefined()
    expect(activeTimer.activeMs.value).toBe(60_000)
    expect(auditLog.map(e => e.id)).toEqual(['a9'])
  })

  it('restoreDraftAudit は変更履歴だけを戻し、在庫には触らない', () => {
    localStorage.setItem('inv_draft_s1', JSON.stringify({
      inv: { 'トマト': { qty: 3, unit: '箱' } }, activeMs: 0, audit: [audit('a1', 'トマト', 1)],
    }))
    restoreDraftAudit('s1')
    expect(auditLog.map(e => e.id)).toEqual(['a1'])
    expect(inventory['トマト']).toBeUndefined()
  })

  it('clearDraft はそのセッションの下書きだけを消す', () => {
    localStorage.setItem('inv_draft_s1', '{}')
    localStorage.setItem('inv_draft_s2', '{}')
    clearDraft('s1')
    expect(localStorage.getItem('inv_draft_s1')).toBeNull()
    expect(localStorage.getItem('inv_draft_s2')).toBe('{}')
  })
})
