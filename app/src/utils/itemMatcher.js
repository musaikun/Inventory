// ── 辞書マッチング（音声/テキスト入力 → 品目候補）────────────────────────────

export function normalize(str) {
  return str
    .normalize('NFKC')  // 半角カタカナ→全角カタカナ、全角英数→半角英数
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))  // カタカナ→ひらがな
}

export function scoreMatch(nTarget, nInput) {
  if (nTarget === nInput)              return 1000
  if (nTarget.startsWith(nInput))     return 500 + nInput.length
  if (nInput.startsWith(nTarget))     return 400 + nTarget.length
  if (nTarget.includes(nInput))       return 300 + nInput.length
  if (nInput.includes(nTarget))       return 200 + nTarget.length
  return 0
}

export function isSupplyItem(canonical, categories) {
  const cat = categories?.[canonical]
  if (!cat) return false
  return cat.includes('資材') || cat.includes('備品') || cat.includes('その他')
}

/**
 * 入力文字列から品目候補をスコア順に返す。
 * @param {string} name 検索語
 * @param {object} ctx { dictionary, order, categories, masterDict, scope }
 *   - dictionary: { alias: canonical } エイリアス辞書（CSV定義 + 自動学習）
 *   - order:      正式品目名のリスト
 *   - categories: { canonical: category } カテゴリマップ
 *   - masterDict: { keyword: canonical[] } マスター辞書（1キーワード→複数品目）
 *   - scope:      'all' | 'food' | 'supply'
 */
export function findCandidates(name, { dictionary = {}, order = [], categories = {}, masterDict = {}, scope = 'all' } = {}) {
  if (!name) return []
  const nInput = normalize(name)
  const seen   = new Map()

  // ① 辞書エイリアスとのマッチ
  for (const [alias, canonical] of Object.entries(dictionary)) {
    const score = scoreMatch(normalize(alias), nInput)
    if (score > 0 && score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
  }

  // ② 正式品目名そのものともマッチ（"コーヒー豆" → "コーヒー豆 ブラジル..." を拾う）
  for (const canonical of order) {
    const score = scoreMatch(normalize(canonical), nInput)
    // エイリアス経由より若干低いスコアで登録（エイリアスを優先）
    const adjusted = score > 0 ? Math.max(score - 50, 1) : 0
    if (adjusted > 0 && adjusted > (seen.get(canonical) ?? 0)) seen.set(canonical, adjusted)
  }

  // ③ マスター辞書（1キーワード→複数品目）
  for (const [keyword, canonicals] of Object.entries(masterDict)) {
    const score = scoreMatch(normalize(keyword), nInput)
    if (score > 0) {
      for (const canonical of canonicals) {
        if (!order.includes(canonical)) continue
        if (score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
      }
    }
  }

  let results = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)

  if (scope === 'food') {
    results = results.filter(c => !isSupplyItem(c, categories))
  } else if (scope === 'supply') {
    results = results.filter(c => isSupplyItem(c, categories))
  }

  return results
}
