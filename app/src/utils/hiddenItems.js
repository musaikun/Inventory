// 手動非表示の一覧の「並び」と「いつ隠したか」。
//
// 非表示は左スワイプで確認なしに決まる（引き切ったときだけ）。速い代わりに、
// 縦スクロールの巻き添えなどで意図せず隠すことがある。そのとき見る場所が一覧なので、
// **最後に隠したものを先頭**に置き、時刻を添える。2件続けて誤操作しても、
// 上の2行を見れば何をいつ隠したのかが分かる。
//
// 時刻を持たないのは、この記録より前に隠した品目（`hiddenAt` が無い）。
// 消さずに後ろへ回し、元の並び順のまま残す。

/**
 * 非表示にした新しい順に並べる。時刻の無い品目は後ろ（元の順序のまま）。
 * @param {string[]} names    非表示の品目名
 * @param {object}   hiddenAt 品目名 → ISO文字列
 */
export function sortHiddenByRecent(names = [], hiddenAt = {}) {
  const at = (n) => String(hiddenAt?.[n] ?? '')
  // ISO文字列は辞書順＝時系列順。Array#sort は安定なので、同着（時刻なし同士）は元の順に残る。
  return [...names].sort((a, b) => at(b).localeCompare(at(a)))
}

/**
 * 非表示にした時刻の表示。直近ほど細かく、古いものほど粗く出す。
 * 今日 13:24 ／ 昨日 22:05 ／ 9/5 18:02 ／ 2025/9/5
 * @param {string} iso ISO文字列（空・不正は空文字）
 * @param {Date}   now 基準時刻（テスト用）
 */
export function hiddenAtLabel(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDate = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDate(d, now)) return `今日 ${hm}`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDate(d, yesterday)) return `昨日 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
