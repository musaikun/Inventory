// 「カレンダーに無い棚卸」＝ D1 の sessions に行が無いのに、棚卸の記録（スナップショット）だけが残っているもの。
// 以前の削除（sessions の行だけを消していた・F-004）や、別端末で消した記録の送り直しで生まれる。
// 在庫分析は記録を、カレンダーは sessions を見ているので、ここがずれると日付が食い違う（F-003）。
//
// sessions 一覧はサーバーが新しい順に SESSIONS_LIMIT 件までしか返さない（F-002）。
// 返ってきた範囲より古い記録は「無い」と言い切れないので判定しない。

export const SESSIONS_LIMIT = 50

/**
 * @param {Array} snapshots useHistory().getSnapshots()
 * @param {Array|null} sessions getSessions() の結果（null = 取得できていない → 判定しない）
 * @returns {Array} sessions に行の無いスナップショット（新しい順）
 */
export function orphanSnapshots(snapshots = [], sessions = null) {
  if (!Array.isArray(sessions)) return []
  const ids = new Set(sessions.map(s => String(s?.id)).filter(Boolean))
  let since = ''
  if (sessions.length >= SESSIONS_LIMIT) {
    since = sessions.map(s => String(s?.startedAt || '').slice(0, 10)).filter(Boolean).sort()[0] || ''
  }
  return (snapshots || [])
    .filter(s => s?.sessionId && !ids.has(String(s.sessionId)))   // sessionId の無い旧データは突き合わせられない
    .filter(s => !since || (s.date && s.date > since))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
