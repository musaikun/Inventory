/**
 * 取込の「レシピ」＝一度決めた読み方に名前を付けて保存し、次に同じ形の
 * ファイルを開いたら問いを飛ばして同じように読む。
 *
 * 同じ帳票は毎月同じ形で来る。2回目以降に人が答えることは本来1つも無いはずで、
 * 答えさせているうちは仕組みが仕事をしていない。
 *
 * 既に `pdfProfiles.js` が同じ役目を持っていたが、指紋が**トークンのx座標**なので
 * PDFにしか効かなかった。CSV/Excel には座標が無く、レシピを作ることも当てることも
 * できない。ここでは指紋を**見出しの名前の集合**（見出しの無い表は列の形）に置き換え、
 * 全経路で同じ仕組みを使う。一致判定のしきい値は pdfProfiles と同じ Jaccard 0.6 に
 * そろえてある ── 経路で当たり方が変わると、説明のつかない差になるため。
 *
 * 保存するのは「読み方」だけ。品目の中身は覚えないので、来月の数字はそのまま新しい方が入る。
 */
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { normHeader } from '../utils/importText.js'

const MATCH_MIN = 0.6   // 一致とみなす Jaccard しきい値（pdfProfiles と同じ値）
const FP_TOP    = 60    // PDF の指紋に使う上部トークン数
const FP_ROUND  = 4     // PDF の指紋で x を丸める粒度(px)

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.importRecipes)
    if (raw === null) return _migrateFromPdfProfiles()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (_) { return [] }
}

/**
 * 旧 `pdfProfiles` に保存済みのレシピを引き継ぐ。
 * ここを飛ばすと、いま毎月のPDFをレシピで読んでいる人が、更新した瞬間に
 * 「レシピが消えた」状態になる。移行は1回だけで、旧キーは消さない（戻せるように）。
 */
function _migrateFromPdfProfiles() {
  let old = []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pdfProfiles)
    old = raw ? JSON.parse(raw) : []
    if (!Array.isArray(old)) old = []
  } catch (_) { return [] }
  const moved = old.map(p => ({
    id: p.id, name: p.name, createdAt: p.createdAt, kind: 'pdf',
    fp: { kind: 'pdf', x: p.fingerprint ?? [] },
    columns: (p.columns ?? []).map(c => ({ field: c.field, x: c.x })),
    fromY: p.fromY,
  }))
  _save(moved)
  return moved
}
function _save(list) {
  try { localStorage.setItem(STORAGE_KEYS.importRecipes, JSON.stringify(list)) } catch (_) {}
}
function _uid() { return 'rc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }

function _jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b)
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const v of sa) if (sb.has(v)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** PDFトークン（{text,x,y}）から列位置の指紋を作る（pdfProfiles と同じ作り方） */
export function fingerprintTokens(items) {
  if (!Array.isArray(items) || items.length === 0) return []
  const top = [...items].sort((a, b) => b.y - a.y).slice(0, FP_TOP)
  const set = new Set()
  for (const it of top) set.add(Math.round(it.x / FP_ROUND) * FP_ROUND)
  return [...set].sort((a, b) => a - b)
}

/**
 * 表（records = tokenizeCSV の rows）の指紋。
 *
 * @param {Array}  records 行の配列（{ cols }）
 * @param {number} headerRow 見出しの行（-1 = 見出し無し）
 */
export function fingerprintTable(records, headerRow) {
  const cols = records.reduce((n, r) => Math.max(n, r.cols?.length ?? 0), 0)
  const head = headerRow >= 0
    ? (records[headerRow]?.cols ?? []).map(normHeader).filter(Boolean)
    : []
  // 見出しが無いファイルには名前が無いので、列の形（文字／数字／空）で見る。
  // 名前で当てるより弱い根拠なので、点も割り引く（下の _score）。
  const shape = headerRow >= 0 ? [] : (records[headerRow + 1]?.cols ?? []).map(c => {
    const v = normHeader(c)
    return !v ? '-' : /^[-0-9.,¥￥]+$/.test(v) ? 'n' : 't'
  })
  return { kind: 'table', cols, headerRow, head, shape }
}

/** PDF用の指紋 */
export function fingerprintPdf(items) {
  return { kind: 'pdf', x: fingerprintTokens(items) }
}

function _score(recipe, fp) {
  const a = recipe?.fp
  if (!a || !fp || a.kind !== fp.kind) return 0
  if (fp.kind === 'pdf') return _jaccard(a.x ?? [], fp.x ?? [])
  if (a.cols !== fp.cols) return 0                       // 列数が違えば別の帳票
  if (a.head.length) return _jaccard(a.head, fp.head)
  if (!a.shape.length || !fp.shape.length) return 0
  const n = Math.max(a.shape.length, fp.shape.length)
  let same = 0
  for (let i = 0; i < n; i++) if (a.shape[i] === fp.shape[i]) same++
  return (same / n) * 0.9
}

export function listRecipes() { return _load() }

/**
 * いまの読み方を1枚にして保存する。
 * `columns` は列番号だけでなく見出しの名前も控える ── 来月そのファイルの列が
 * 1本増えても、名前が同じならそこへ付け直せる。
 */
export function saveRecipe(rec) {
  const list = _load()
  const saved = { ...rec, id: rec.id || _uid(), createdAt: new Date().toISOString() }
  // 同じ紙のレシピは置き換える。2枚あると、どちらが当たったのかを人が確かめられない。
  const i = list.findIndex(p => _score(p, saved.fp) >= 0.95)
  if (i >= 0) list.splice(i, 1, saved)
  else list.push(saved)
  _save(list)
  return saved
}

export function deleteRecipe(id) { _save(_load().filter(p => p.id !== id)) }

export function renameRecipe(id, name) {
  const list = _load()
  const r = list.find(p => p.id === id)
  if (!r) return null
  r.name = name
  _save(list)
  return r
}

/** 指紋に最も近い保存済みレシピ（しきい値未満は null） */
export function matchRecipe(fp) {
  let best = null, bestScore = 0
  for (const p of _load()) {
    const s = _score(p, fp)
    if (s > bestScore) { best = p; bestScore = s }
  }
  return bestScore >= MATCH_MIN ? best : null
}

/**
 * 保存されたレシピを、いまのファイルの列へ当てはめる。
 * 見出しの名前で探し、無ければ列番号にする。
 */
export function applyRecipeColumns(recipe, headerCols) {
  const head = (headerCols ?? []).map(normHeader)
  const mapping = {}
  const n = head.length
  for (const c of (recipe?.columns ?? [])) {
    let i = c.head ? head.indexOf(c.head) : -1
    if (i < 0) i = c.col
    if (typeof i !== 'number' || i < 0 || (n > 0 && i >= n)) continue
    mapping[c.field] = i
  }
  return mapping
}

/** ファイル名から名前の見当を作る（拡張子と、月ごとに変わる数字を落とす） */
export function suggestRecipeName(filename) {
  let n = String(filename ?? '').replace(/\.[a-z0-9]+$/i, '')
  n = n.replace(/(19|20)[0-9]{2}[-_/年]?[0-9]{1,2}([-_/月]?[0-9]{1,2})?[日]?/g, '')
  n = n.replace(/(19|20)[0-9]{2}/g, '')
  n = n.replace(/[_\-\s]{2,}/g, '_').replace(/^[_\-\s]+|[_\-\s]+$/g, '')
  return n || String(filename ?? '').replace(/\.[a-z0-9]+$/i, '') || '無題のレシピ'
}
