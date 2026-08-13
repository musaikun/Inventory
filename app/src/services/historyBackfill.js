/**
 * 棚卸スナップショットのバックフィル判定（DATA-002 Phase 2）
 *
 * 一覧（D1 `sessions`）と詳細（`store_history` のスナップショット）は持ち主が違う。
 * 保存が片方だけ失敗すると「一覧には出るが詳細が開けない」状態になる（R-001）。
 * 端末に残っているスナップショットのうち D1 に届いていないものを洗い出し、
 * 起動時・ログイン時に送り直すことで、この片落ちを自動で埋める。
 *
 * 判定は sessionId を正本キーにする（DATA-002 / F-001）。日付キーで突き合わせると、
 * 同じ日に2回棚卸したとき片方をもう片方で「既に送信済み」と誤判定して落としてしまう。
 * sessionId を持たない行（過去取込・旧データ）だけ日付で突き合わせる。
 *
 * 新旧の判定に **端末時計は使わない**（DATA-001 §4）。時計を戻した端末の訂正が
 * 「古い」と見なされて送られなくなるため、送るかどうかは
 *   1. リモートに無い
 *   2. 端末でだけ訂正した（dirty）
 * の2つだけで決める。
 */

import { isSnapshotDirty, isSnapshotComplete } from '../utils/snapshotSync.js'

/** 突き合わせキー。sessionId があればそれ、無ければ日付 */
function _key(snap) {
  return snap?.sessionId ? `s:${snap.sessionId}` : (snap?.date ? `d:${snap.date}` : '')
}

/**
 * ローカルにあって D1 に無い（または端末側に未送信の訂正がある）スナップショットを返す。
 *
 * @param {Array}  localSnapshots  端末のスナップショット（useHistory の getSnapshots()）
 * @param {Array}  remoteSnapshots D1 から取得したスナップショット（null 可 = 取得失敗）
 * @param {number|object} options  上限件数、または { limit, activeSessionIds }
 * @returns {Array} 送り直すべきスナップショット（新しい日付順）
 */
export function missingSnapshots(localSnapshots, remoteSnapshots, options = {}) {
  if (!Array.isArray(localSnapshots) || localSnapshots.length === 0) return []
  // 取得できなかった場合は「D1 は空」ではなく「不明」。全件送ると通信も上書きも過剰なので何もしない。
  if (!Array.isArray(remoteSnapshots)) return []

  const { limit = 10, activeSessionIds = [] } =
    typeof options === 'number' ? { limit: options } : (options ?? {})
  // 進行中セッションのスナップショットは「完了の記録」ではない。送ると、サーバー側で
  // まだ active なセッションに完了済みの履歴だけが生まれ、一覧と詳細が食い違う。
  const active = new Set([...activeSessionIds].filter(Boolean).map(String))

  const remoteByKey = new Map()
  for (const snap of remoteSnapshots) {
    const k = _key(snap)
    if (k) remoteByKey.set(k, snap)
  }

  const missing = []
  for (const snap of localSnapshots) {
    if (!snap?.date || !isSnapshotComplete(snap)) continue
    if (snap.sessionId && active.has(String(snap.sessionId))) continue
    const k = _key(snap)
    if (!k) continue
    if (!remoteByKey.has(k) || isSnapshotDirty(snap)) missing.push(snap)
  }

  return missing
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}
