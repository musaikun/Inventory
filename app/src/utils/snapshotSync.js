/**
 * スナップショットの同期状態を読む純関数（DATA-001 §4 / 履歴revision契約）
 *
 * 端末時計（savedAt / updatedAt）は端末間の新旧判定に使えない。時計を戻した端末の
 * 訂正が「古い」と判定されて消えるため、判定はサーバーが採番した値と、
 * 端末側の明示的な状態（dirty / synced）だけで行う。
 *
 *   serverRevision … 第一優先。保存のたびにサーバーが単調増加させる
 *   serverSavedAt  … revision を返さない旧サーバー・旧行のための fallback
 *   dirty          … 端末でだけ訂正し、まだサーバーが確認していない
 *   synced         … いまの内容をサーバーが確認済み
 *
 * useHistory（保管）と historyBackfill（再送判定）が同じ判定を使うため、
 * どちらにも属さないここへ置く。
 */

/** サーバーが記録した保存時刻(ms)。無ければ null（= 未同期） */
export function serverSavedMs(snap) {
  const t = Date.parse(snap?.serverSavedAt ?? '')
  return Number.isFinite(t) ? t : null
}

/**
 * サーバーが採番したリビジョン。無ければ null。
 *
 * `serverSavedAt` は同一秒に2回保存すると差が出ず、サーバー時刻の巻き戻し
 * （NTP補正）でも順序が壊れるため、revision を第一優先にして時刻は fallback にする。
 */
export function serverRevision(snap) {
  const v = snap?.serverRevision
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** client時計による保存時刻(ms)。旧データ同士の比較にだけ使う */
export function clientSavedMs(snap) {
  const t = Date.parse(snap?.updatedAt ?? snap?.savedAt ?? '')
  return Number.isFinite(t) ? t : 0
}

/**
 * 端末でだけ訂正され、まだサーバーが確認していないスナップショットか。
 *
 * `dirty` を持たない旧データだけ、「訂正の跡（updatedAt）があってサーバー確認の
 * 形跡が無い」ことをもって未送信とみなす（移行用）。
 */
export function isSnapshotDirty(snap) {
  if (!snap || typeof snap !== 'object') return false
  if (typeof snap.dirty === 'boolean') return snap.dirty
  return !!snap.updatedAt && !snap.synced &&
         serverRevision(snap) == null && serverSavedMs(snap) == null
}

/**
 * 詳細表示に使える中身を持つスナップショットか。
 *
 * 完了処理が途中で落ちた端末には、明細の無い・書きかけのスナップショットが
 * 残りうる。これを「端末に記録がある」と扱うと、サーバーには正しい明細があるのに
 * 空の詳細を見せてしまう。中身が揃わないものは無いものとして扱い、
 * 呼び出し側が sessionId で明細を取り直す。
 */
export function isSnapshotComplete(snap) {
  if (!snap || typeof snap !== 'object') return false
  if (snap.pending) return false
  return Array.isArray(snap.items) && snap.items.length > 0
}
