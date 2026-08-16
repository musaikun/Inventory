/**
 * 取込の日付正規化と実在判定（IMPORT-001）。**納品取込と棚卸結果取込の唯一の実装。**
 *
 * 修正前は両方が同じ正規表現を各自で持ち、月 1..12 / 日 1..31 の**範囲だけ**を見ていた。
 * そのため `2026-02-30` や平年の `2025-02-29` が 'YYYY-MM-DD' として通り、
 * 存在しない日の棚卸セッションが作られていた（カレンダーにも出る）。
 *
 * ここでは ISO 化したあとに年月日を round-trip して確認する。
 * `Date.UTC` は 2月30日を3月2日へ繰り上げるので、繰り上がった時点で不正と判定できる。
 * UTC で組み立てるのは、端末のタイムゾーンで日付がずれないようにするため。
 */

/**
 * 日付文字列を 'YYYY-MM-DD' へ正規化する。解釈できない・実在しない日は '' を返す。
 *
 * 受理する表記: `2026-06-01` / `2026/6/1` / `2026.6.1` / `2026年6月1日`（前後の空白は無視）
 *
 * @param {*} s
 * @returns {string} 'YYYY-MM-DD' または ''
 */
export function normalizeImportDate(s) {
  let t = String(s ?? '').trim()
  if (!t) return ''

  t = t.replace(/年|月/g, '-').replace(/日/g, '').replace(/[./]/g, '-').trim()
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ''

  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''

  // 実在確認: 組み立てた日付が同じ年月日へ戻るか（2月30日 → 3月2日 などを弾く）
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return ''

  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
