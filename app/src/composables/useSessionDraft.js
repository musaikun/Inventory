// セッション単位の在庫下書き（localStorage）。セッション切り替え・退室・再読込・ブラウザのクラッシュで
// 入力を失わないために、セッションIDごとに「在庫・稼働時間・変更履歴」を端末へ残す。
//
// もとは App.vue の中にあった。いつ保存・復元・削除するか（入力のたび・再開・完了）は App が決め、
// ここは下書きの形と、戻し方（下書きが無ければ完了時のスナップショットから）だけを持つ。
import { useInventory, applyRemoteUpdate } from './useInventory.js'
import { useSync, mergeAuditLog } from './useSync.js'
import { useHistory } from './useHistory.js'

const _DRAFT_PREFIX = 'inv_draft_'

// activeTimer: App の稼働時間タイマー（useActiveTimer は呼ぶたびに別のタイマーを作るので受け取る）
export function useSessionDraft({ activeTimer }) {
  const { inventory } = useInventory()
  const { auditLog } = useSync()
  const { getSnapshotBySessionId } = useHistory()

  function saveDraft(sessionId) {
    if (!sessionId) return
    if (Object.keys(inventory).length === 0 && auditLog.length === 0) return
    try {
      localStorage.setItem(_DRAFT_PREFIX + sessionId, JSON.stringify({
        inv:      { ...inventory },
        activeMs: activeTimer.activeMs.value,
        // 変更履歴はメモリにしか無い。下書きに入れておかないと、退室・再読込のたびに
        // そこまでの履歴が消え、完了時のスナップショットにも入らない。
        audit:    [...auditLog],
      }))
    } catch (_) {}
  }

  /**
   * 完了済みセッションを開き直したときの復元。
   *
   * 完了すると下書きは消える（`clearDraft`）。同じ日の2回目の棚卸を「続きから」にする以上、
   * **完了したときの姿へ戻す**必要がある。スナップショットは sessionId で引けて、
   * 数量・変更履歴・稼働時間・誰が入れたかを全部持っているので、そこから戻す。
   *
   * 戻さないと、続きのはずが空の在庫と 0 分から始まり、完了したときに前の記録を
   * 上書きしてしまう（スナップショットは sessionId が正本キーなので、同じ枠に入る）。
   */
  function _restoreFromSnapshot(sessionId) {
    const snap = getSnapshotBySessionId(sessionId)
    if (!snap) return false
    if (typeof snap.activeMs === 'number') activeTimer.resume(snap.activeMs)
    mergeAuditLog(snap.auditLog)
    // 「誰が・いつ」は participants 側にしか無い。ここで品目へ引き直す
    const by = new Map()
    for (const p of snap.participants ?? []) {
      for (const it of p.items ?? []) by.set(it.item, { name: p.name, at: it.at })
    }
    for (const it of snap.items ?? []) {
      if (it?.qty === null || it?.qty === undefined) continue
      const a = by.get(it.item)
      applyRemoteUpdate(it.item, it.qty, it.unit ?? '', a?.name ?? '', a?.at ?? snap.savedAt)
    }
    return true
  }

  function restoreDraft(sessionId) {
    if (!sessionId) return
    try {
      const raw = localStorage.getItem(_DRAFT_PREFIX + sessionId)
      // 下書きが無い＝完了済みを開き直した。完了したときの姿へ戻す
      if (!raw) { _restoreFromSnapshot(sessionId); return }
      const saved = JSON.parse(raw)
      // 新形式 { inv, activeMs } と旧形式（フラットな inventory）の両対応
      const inv = saved.inv ?? saved
      if (typeof saved.activeMs === 'number') activeTimer.resume(saved.activeMs)
      // 変更履歴を先に戻す。applyRemoteUpdate は auditLog を触らないので二重にはならない。
      mergeAuditLog(saved.audit)
      for (const [ingredient, entry] of Object.entries(inv)) {
        if (!entry || typeof entry.qty === 'undefined') continue
        applyRemoteUpdate(ingredient, entry.qty, entry.unit ?? '', entry.enteredBy ?? '', entry.updatedAt)
      }
    } catch (_) {}
  }

  // 変更履歴だけを下書きから戻す。
  // 起動時（再読込）は在庫を useInventory 側の保存から戻すので restoreDraft を通らない。
  // auditLog はメモリにしか無いため、ここで戻さないと再読込のたびに履歴が空になる。
  function restoreDraftAudit(sessionId) {
    if (!sessionId) return
    try {
      const raw = localStorage.getItem(_DRAFT_PREFIX + sessionId)
      if (!raw) return
      mergeAuditLog(JSON.parse(raw)?.audit)
    } catch (_) {}
  }

  function clearDraft(sessionId) {
    if (!sessionId) return
    try { localStorage.removeItem(_DRAFT_PREFIX + sessionId) } catch (_) {}
  }

  return { saveDraft, restoreDraft, restoreDraftAudit, clearDraft }
}
