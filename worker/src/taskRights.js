/**
 * やることの権限（User決定 2026-10-14）。完了したら「記録」として固める。
 * **app/src/services/taskRights.js と同じ中身**にする（片方を変えたら両方を変える。テストで突き合わせる）。
 *
 * - 完了の印: 担当が特定の人ならその人（管理者は代わりに付けられる）。「誰でも」「未定」は誰でも
 * - 取り消し: 付けた本人がその日のうちだけ。それ以降は管理者だけ（差し戻し）
 * - 付け直し: その日のうちに取り消した本人が付け直したら、元の完了時刻に戻す
 * - 文面・日付・時刻・担当を直す: 未完了の間だけ、作った人（やることを作る権限があるとき）と管理者
 * - 消す: 未完了の間だけ、作った人（同上）と管理者。完了したものは誰も消せない
 * 管理者 = オーナーと管理者（役割 admin）
 *
 * @typedef {{ id: string, admin: boolean, canCreate: boolean }} Me
 * dayOf(iso) は「その日」の日付キー（端末はその端末の日付、サーバーは日本時間）
 */

const _done = t => !!t?.doneAt

/** 完了の印を付けられるか（「全員」は各自の印なので別） */
export function canComplete(t, me) {
  if (!t || t.deletedAt || _done(t)) return false
  if (t.assign === 'person') return t.assigneeId === me.id || me.admin
  return true
}

/** 完了を取り消せるか。本人はその日のうち、管理者はいつでも */
export function canUndo(t, me, today, dayOf) {
  if (!t || t.deletedAt || !_done(t)) return false
  if (me.admin) return true
  return !!t.doneById && t.doneById === me.id && dayOf(t.doneAt) === today
}

/** 「全員」のやることで自分の印を外せるか（本人がその日のうち。管理者はいつでも） */
export function canUnmark(t, me, today, dayOf) {
  const mine = (t?.doneList ?? []).find(x => x.id === me.id)
  if (!mine) return false
  return me.admin || dayOf(mine.at) === today
}

/** 文面・日付・時刻・担当を直せるか */
export function canEdit(t, me) {
  if (!t || t.deletedAt || _done(t)) return false
  return me.admin || (t.createdById === me.id && me.canCreate)
}

/** 消せるか（完了したものは誰も消せない） */
export function canRemove(t, me) {
  return canEdit(t, me)
}

/**
 * 付け直しのときの完了時刻。その日のうちに取り消した本人なら元の時刻、ほかは now。
 * 取り消しのときに prevDoneAt / prevDoneById を残しておく（管理者の差し戻しは残さない）
 */
export function redoDoneAt(t, me, now, today, dayOf) {
  if (t?.prevDoneAt && t.prevDoneById === me.id && dayOf(t.prevDoneAt) === today) return t.prevDoneAt
  return now
}

/** 取り消しのときに残す元の完了（本人の取り消しだけ。管理者が他人の完了を差し戻したら残さない） */
export function undoKeep(t, me) {
  if (t?.doneById && t.doneById === me.id) return { prevDoneAt: t.doneAt, prevDoneById: t.doneById }
  return { prevDoneAt: null, prevDoneById: null }
}
