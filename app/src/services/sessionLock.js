// 完了済み棚卸の編集ロック判定と、削除確認の文言。
// ホーム（SessionListPage）と履歴カレンダーページの両方から同じ条件で削除するため、
// 判定を1か所に置く。片方だけ条件が緩むと「ロック済みの警告なしに消せる入口」が生まれる。

export const CORRECTION_DAYS = 3

/**
 * 完了済みセッションが訂正不可（ロック）かどうか。
 * @param {object} session 対象セッション
 * @param {object} ctx
 * @param {boolean} ctx.snapshotLocked 端末のスナップショットが恒久ロック済みか
 *   （新しい棚卸の完了で確定済み。新しい方を削除しても外れない）
 * @param {Array}  ctx.completedSessions 同じ店舗の完了済みセッション（自分を含んでよい）
 */
export function isSessionLocked(session, { snapshotLocked = false, completedSessions = [] } = {}) {
  if (snapshotLocked) return true
  if (!session?.endedAt) return false
  if (Date.now() - new Date(session.endedAt).getTime() > CORRECTION_DAYS * 86400_000) return true
  return completedSessions.some(s =>
    s.id !== session.id && new Date(s.startedAt) > new Date(session.endedAt)
  )
}

/** 削除前の確認文言。進行中・ロック済み・通常でリスクの重さを変える。 */
export function deleteConfirmMessage(session, locked = false) {
  if (session?.status === 'active') {
    return '進行中のセッションを削除します。\n入力中のデータも失われます。\n\nこの操作は取り消せません。本当に削除しますか？'
  }
  if (locked) {
    return '確定済み（編集ロック）の棚卸です。\n削除すると復元できません。\n\n本当に削除しますか？'
  }
  return 'このセッションを削除します。\n\nこの操作は取り消せません。本当に削除しますか？'
}
