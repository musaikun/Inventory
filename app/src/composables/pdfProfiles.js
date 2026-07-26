import { STORAGE_KEYS } from '../utils/storageKeys.js'

// PDFの列マッピング「レシピ」を保存し、同じレイアウトの再取込で自動適用する。
// プロファイル = { id, name, createdAt, fingerprint, columns:[{field,x}], fromY }
// fingerprint = 列のx位置グリッドの指紋（品目名は変わっても列位置は同じなので一致する）。

const _FP_TOP = 60        // 指紋に使う上部トークン数
const _FP_ROUND = 4       // x を丸める粒度(px)
const _MATCH_MIN = 0.6    // 一致とみなす Jaccard しきい値

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pdfProfiles)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch (_) { return [] }
}
function _save(list) {
  try { localStorage.setItem(STORAGE_KEYS.pdfProfiles, JSON.stringify(list)) } catch (_) {}
}
function _uid() { return 'pf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

/** トークン配列（{text,x,y}）から列位置の指紋（丸めたxの集合）を作る */
export function fingerprintTokens(items) {
  if (!Array.isArray(items) || items.length === 0) return []
  const top = [...items].sort((a, b) => b.y - a.y).slice(0, _FP_TOP)
  const set = new Set()
  for (const it of top) set.add(Math.round(it.x / _FP_ROUND) * _FP_ROUND)
  return [...set].sort((a, b) => a - b)
}

function _jaccard(a, b) {
  if (!a.length || !b.length) return 0
  const sa = new Set(a), sb = new Set(b)
  let inter = 0
  for (const v of sa) if (sb.has(v)) inter++
  return inter / (sa.size + sb.size - inter)
}

export function listProfiles() { return _load() }

export function saveProfile({ name, columns, fromY, fingerprint }) {
  const list = _load()
  const rec = { id: _uid(), name: name || '無名レシピ', createdAt: new Date().toISOString(), fingerprint, columns, fromY }
  // 同じ指紋の既存レシピは置き換える
  const i = list.findIndex(p => _jaccard(p.fingerprint || [], fingerprint || []) >= 0.95)
  if (i >= 0) list.splice(i, 1, rec)
  else list.push(rec)
  _save(list)
  return rec
}

export function deleteProfile(id) {
  const list = _load().filter(p => p.id !== id)
  _save(list)
}

/** トークンの指紋に最も近い保存済みレシピを返す（しきい値未満は null） */
export function matchProfile(items) {
  const fp = fingerprintTokens(items)
  let best = null, bestScore = 0
  for (const p of _load()) {
    const s = _jaccard(p.fingerprint || [], fp)
    if (s > bestScore) { best = p; bestScore = s }
  }
  return bestScore >= _MATCH_MIN ? best : null
}
