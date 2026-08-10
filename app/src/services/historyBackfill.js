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
 */

/** 突き合わせキー。sessionId があればそれ、無ければ日付 */
function _key(snap) {
  return snap?.sessionId ? `s:${snap.sessionId}` : (snap?.date ? `d:${snap.date}` : '')
}

/** client時計の保存時刻（同一キー同士の比較にだけ使う） */
function _savedAtMs(snap) {
  const t = Date.parse(snap?.updatedAt ?? snap?.savedAt ?? '')
  return Number.isFinite(t) ? t : 0
}

/**
 * ローカルにあって D1 に無い（または D1 側が古い）スナップショットを返す。
 *
 * @param {Array}  localSnapshots  端末のスナップショット（useHistory の getSnapshots()）
 * @param {Array}  remoteSnapshots D1 から取得したスナップショット（null 可 = 取得失敗）
 * @param {number} limit           1回で送る上限（大量アップロードを避ける）
 * @returns {Array} 送り直すべきスナップショット（新しい日付順）
 */
export function missingSnapshots(localSnapshots, remoteSnapshots, limit = 10) {
  if (!Array.isArray(localSnapshots) || localSnapshots.length === 0) return []
  // 取得できなかった場合は「D1 は空」ではなく「不明」。全件送ると通信も上書きも過剰なので何もしない。
  if (!Array.isArray(remoteSnapshots)) return []

  const remoteByKey = new Map()
  for (const snap of remoteSnapshots) {
    const k = _key(snap)
    if (k) remoteByKey.set(k, snap)
  }

  const missing = []
  for (const snap of localSnapshots) {
    if (!snap?.date || !Array.isArray(snap.items) || snap.items.length === 0) continue
    const k = _key(snap)
    if (!k) continue
    const remote = remoteByKey.get(k)
    // D1 に無い、または D1 側が古い（訂正・ロックが届いていない）ものだけ送る。
    // 端末時計が前後しても、キーが一致しない別セッションへは決して寄せない。
    if (!remote || _savedAtMs(remote) < _savedAtMs(snap)) missing.push(snap)
  }

  return missing
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}
