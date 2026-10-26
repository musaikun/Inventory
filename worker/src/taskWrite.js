// やることの書き込みを、今の1件と見比べて確かめる（User決定 2026-10-14・規則は taskRights.js）。
// 画面で押せなくしているだけでは、古い端末や画面を通らない書き込みを止められないので、サーバーでも同じ規則で見る。
import { canComplete, canUndo, canEdit, canRemove, redoDoneAt, undoKeep } from './taskRights.js'

/** 「その日」は日本時間の日付（店は日本。端末の日付とは日付が変わる前後だけずれうる） */
export const dayJst = iso => {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 10) : ''
}

const _stepsOf = v => {
  let a = v
  if (typeof v === 'string') { try { a = JSON.parse(v) } catch (_) { a = [] } }
  return Array.isArray(a) ? a.map(x => [String(x?.id ?? ''), String(x?.text ?? '').trim(), !!x?.done]) : []
}

const _task = r => ({
  assign: r.assign_mode ?? 'anyone', assigneeId: r.assignee_id ?? null, createdById: r.created_by_id ?? '',
  doneAt: r.done_at ?? null, doneById: r.done_by_id ?? null, deletedAt: r.deleted_at ?? null,
  prevDoneAt: r.prev_done_at ?? null, prevDoneById: r.prev_done_by_id ?? null, kind: r.kind ?? null,
  visibility: r.visibility === 'admins' ? 'admins' : null,
})

/**
 * @param {object} row  今の1件（tasks の行）
 * @param {object} body 端末が送った1件（必要なら doneAt をここで直す）
 * @param {{ id: string, admin?: boolean, ctx?: object|null }} who 書く人（ctx が無い＝PIN の無い古い店舗はオーナー扱い）
 * @param {(ctx: object, perm: string) => boolean} ctxCan
 * @returns {{ stale?: true, deny?: string, keepPrev?: { prevDoneAt: string|null, prevDoneById: string|null }|null }}
 */
export function taskWriteCheck(row, body, who, ctxCan, nowIso = new Date().toISOString()) {
  if (row.deleted_at) return { stale: true }   // 消したものへの遅れた書き込みは捨てる
  const me = { id: who.id, admin: !!who.admin || !who.ctx, canCreate: who.ctx ? ctxCan(who.ctx, 'task.create') : true }
  const t = _task(row)
  const wasDone = !!t.doneAt
  // 管理者だけのやることは、管理者以外からは無いものとして扱う（2026-10-15）
  if (t.visibility === 'admins' && !me.admin) return { deny: '見つかりません' }
  if (t.kind) return { deny: 'このやることは、スタッフの画面で承認・お断りすると自動で完了します' }
  if (body?.deletedAt) {
    if (!canRemove(t, me)) return { deny: wasDone ? '完了したやることは消せません' : 'このやることを消せるのは、作った人と管理者だけです' }
    return { keepPrev: null }
  }
  // 担当を変える・文面・日付・時刻を直す
  const assignChanged = (row.assign_mode ?? 'anyone') !== (body?.assign ?? 'anyone')
    || (body?.assign === 'person' && (row.assignee_id ?? '') !== (body?.assigneeId ?? ''))
  const visChanged = (t.visibility === 'admins') !== (body?.visibility === 'admins')
  if (visChanged && !me.admin) return { deny: '「管理者だけ」にできるのは管理者だけです' }
  // 進行中（2026-10-23）: 状態・待っているもの・次に見る日（日付）・期限・手順は、完了にできる人（担当・誰でも）も変えられる
  const progressTask = !!(row.progress || body?.progress)
  const dateChanged = (row.task_date ?? '') !== (body?.date ?? '')
  const edited = visChanged || (row.body ?? '') !== String(body?.text ?? '').trim().slice(0, 200)
    || (dateChanged && !progressTask) || (row.due_time ?? null) !== (body?.dueTime || null)
    // 期限つきのやること（連絡のタスク化・2026-10-26）の期限は、文面と同じく作った人と管理者
    || (!progressTask && (row.deadline ?? null) !== (body?.deadline || null))
  if ((assignChanged || edited) && !canEdit(t, me)) {
    return { deny: wasDone ? '完了したやることは直せません' : 'このやることを直せるのは、作った人と管理者だけです' }
  }
  const progressChanged = progressTask && (dateChanged || (row.progress ?? null) !== (body?.progress ?? null)
    || (row.wait_note ?? null) !== (body?.waitNote || null) || (row.deadline ?? null) !== (body?.deadline || null)
    || JSON.stringify(_stepsOf(row.steps_json)) !== JSON.stringify(_stepsOf(body?.steps)))
  if (progressChanged && !canEdit(t, me) && !canComplete(t, me)) {
    return { deny: '進み具合を変えられるのは、担当の人・作った人・管理者だけです' }
  }
  // 備考（2026-10-26）: 完了にできる人（担当・誰でも）も書き足せる
  const noteChanged = (row.note ?? null) !== (String(body?.note ?? '').trim().slice(0, 500) || null)
  if (noteChanged && !canEdit(t, me) && !canComplete(t, me)) {
    return { deny: '備考を書けるのは、担当の人・作った人・管理者だけです' }
  }
  if (t.assign === 'all') return { keepPrev: null }   // 「全員」の完了は印（/mark）で決まる
  const wantDone = !!body?.doneAt
  const today = dayJst(nowIso)
  if (wantDone && !wasDone) {
    if (!canComplete(t, me)) return { deny: 'このやることを完了にできるのは、担当の人と管理者だけです' }
    body.doneAt = redoDoneAt(t, me, nowIso, today, dayJst)   // その日のうちの付け直しは元の時刻
    return { keepPrev: { prevDoneAt: null, prevDoneById: null } }
  }
  if (!wantDone && wasDone) {
    if (!canUndo(t, me, today, dayJst)) return { deny: '完了を取り消せるのは、完了した人がその日のうちだけです（それ以降は管理者）' }
    return { keepPrev: undoKeep(t, me) }
  }
  if (wasDone) body.doneAt = t.doneAt   // 完了のまま: 完了の時刻は変えない
  return { keepPrev: null }
}
