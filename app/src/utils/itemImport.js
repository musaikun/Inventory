/**
 * 品目マスタ取込のロジック（状態を持たない純粋関数）。
 *
 * 取込は「解析 → 計画 → 適用」の3段に分かれる。
 *   parse*  … ファイルを行の中間表現へ。スキップした行は行番号と理由を残す
 *   buildImportPlan … 現在の品目マスタ＋解析結果から「取込後の状態」と「差分」を組み立てる
 *   （適用は useConfig.js 側。ここでは何も書き換えない）
 *
 * 計画が状態を書き換えないので、取込前プレビューと実際の取込で必ず同じ結果になる。
 */

export const IMPORT_MODE_MERGE   = 'merge'    // 追加・更新（既定）。ファイルに無い既存品目は残す
export const IMPORT_MODE_REPLACE = 'replace'  // 全入れ替え。ファイルに無い既存品目は削除する

// スキップ理由（UI と テストで文字列を共有する）
export const SKIP_NO_NAME   = '品目名が空'
export const SKIP_DUPLICATE = 'ファイル内の重複（先に出てきた行を採用）'

// 差分表示の対象フィールド（label は画面表示、map は config のマップ名）
export const DIFF_FIELDS = [
  { key: 'unit',         label: '単位',       map: 'units' },
  { key: 'price',        label: '単価',       map: 'prices' },
  { key: 'category',     label: 'カテゴリ',   map: 'categories' },
  { key: 'code',         label: '商品コード', map: 'codes' },
  { key: 'prevMonth',    label: '前月実績',   map: 'prevMonths' },
  { key: 'lotSize',      label: '入数',       map: 'lotSizes' },
  { key: 'reorderPoint', label: '発注点',     map: 'reorderPoints' },
]

// ── CSV パーサー ───────────────────────────────────────────────────────────────
// ダブルクォート内のカンマを区切りとして扱わない。クォートは値から取り除く。
export function parseCSVLine(line) {
  const result = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"')              { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                         { cur += ch }
  }
  result.push(cur)
  return result
}

// BOM を除いたうえで、空行を捨てつつ「ファイル上の行番号」を保つ。
// スキップ理由を行番号つきで返すため、trim() で行をずらさない。
function _numberedLines(csvText) {
  return String(csvText ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((raw, i) => ({ raw, line: i + 1 }))
    .filter(l => l.raw.trim())
}

function _cell(cols, idx) {
  if (idx === null || idx === undefined || idx < 0) return undefined
  const v = cols[idx]
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function _num(cols, idx, { positive = false } = {}) {
  const s = _cell(cols, idx)
  if (s === undefined) return undefined
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return undefined
  if (positive ? n > 0 : n >= 0) return n
  return undefined
}

function _aliases(cols, idx) {
  const s = _cell(cols, idx)
  if (s === undefined) return []
  return s.split(',').map(a => a.trim()).filter(Boolean)
}

function _tagList(cols, idx) {
  const s = _cell(cols, idx)
  if (s === undefined) return undefined
  const arr = s.split('|').map(x => x.trim()).filter(Boolean)
  return arr.length ? [...new Set(arr)] : undefined
}

function _emptyParsed() {
  return { rows: [], skipped: [], duplicates: 0, hasReorderColumn: false, headers: [], axisHeaders: [null, null] }
}

/**
 * 棚卸品目 CSV の解析（品目名,単位,単価,カテゴリ,エイリアス,…）。
 * 推奨フォーマット（exportConfigCSV の出力）に加え、旧2/3/4列フォーマットも受け付ける。
 */
export function parseItemCSV(csvText) {
  const lines = _numberedLines(csvText)
  if (lines.length < 2) throw new Error('データ行がありません')

  const headers = parseCSVLine(lines[0].raw).map(h => h.trim())

  const isOldFormat    = headers[1] === 'エイリアス'
  const hasPriceCol    = !isOldFormat && headers[2] === '単価'
  const hasCategoryCol = hasPriceCol  && headers[3] === 'カテゴリ'
  // 発注点は列位置が可変（将来の列追加に耐える）ため、ヘッダ名で位置を特定する。
  // 列が無い旧CSVは既存の発注点を保持（非破壊）。
  const reorderIdx     = headers.indexOf('発注点')
  // 推奨フォーマットの並び替え軸列（10・11列目）。列名はそのまま軸名の候補になる。
  // 発注点列が繰り上がっている旧エクスポートを軸列と誤認しないよう名前で除外する。
  const axisAIdx = (hasCategoryCol && headers[9]  && headers[9]  !== '発注点') ? 9  : -1
  const axisBIdx = (hasCategoryCol && headers[10] && headers[10] !== '発注点') ? 10 : -1

  const parsed = _emptyParsed()
  parsed.headers          = headers
  parsed.hasReorderColumn = reorderIdx >= 0
  parsed.axisHeaders      = [
    axisAIdx >= 0 ? headers[axisAIdx] : null,
    axisBIdx >= 0 ? headers[axisBIdx] : null,
  ]

  const seen = new Set()
  for (const { raw, line } of lines.slice(1)) {
    const cols = parseCSVLine(raw)
    const name = cols[0]?.trim()
    if (!name) { parsed.skipped.push({ line, name: '', reason: SKIP_NO_NAME }); continue }
    if (seen.has(name)) {
      parsed.duplicates++
      parsed.skipped.push({ line, name, reason: SKIP_DUPLICATE })
      continue
    }
    seen.add(name)

    const row = { line, name, aliases: [] }
    if (isOldFormat) {
      row.aliases = _aliases(cols, 1)
    } else if (hasCategoryCol) {
      row.unit         = _cell(cols, 1)
      row.price        = _num(cols, 2, { positive: true })
      row.category     = _cell(cols, 3)
      row.aliases      = _aliases(cols, 4)
      row.code         = _cell(cols, 5)
      row.categoryCode = _num(cols, 6)
      row.prevMonth    = _cell(cols, 7)
      row.lotSize      = _cell(cols, 8)
      row.tagsA        = _tagList(cols, axisAIdx)
      row.tagsB        = _tagList(cols, axisBIdx)
    } else if (hasPriceCol) {
      row.unit    = _cell(cols, 1)
      row.price   = _num(cols, 2, { positive: true })
      row.aliases = _aliases(cols, 3)
    } else {
      row.unit    = _cell(cols, 1)
      row.aliases = _aliases(cols, 2)
    }
    // 発注点列があるときだけ扱う。空セルは「解除」を意味するので null で区別する。
    if (reorderIdx >= 0) row.reorderPoint = _num(cols, reorderIdx) ?? null

    parsed.rows.push(row)
  }

  if (parsed.rows.length === 0) throw new Error('有効な品目が見つかりませんでした')
  return parsed
}

/**
 * 任意CSVをフィールドマッピング指定で解析。
 * mapping = { name, unit, price, category, code, lotSize, prevMonth, axisA, axisB }（null=使用しない）
 */
export function parseMappedCSV(csvText, mapping = {}) {
  const nameCol = mapping.name
  if (nameCol === null || nameCol === undefined) throw new Error('品目名列を選択してください')

  const lines = _numberedLines(csvText)
  if (lines.length < 2) throw new Error('データ行がありません')

  const headers = parseCSVLine(lines[0].raw).map(h => h.trim())
  const parsed  = _emptyParsed()
  parsed.headers     = headers
  parsed.axisHeaders = [
    mapping.axisA != null ? (headers[mapping.axisA] ?? null) : null,
    mapping.axisB != null ? (headers[mapping.axisB] ?? null) : null,
  ]

  const seen = new Set()
  for (const { raw, line } of lines.slice(1)) {
    const cols = parseCSVLine(raw)
    const name = cols[nameCol]?.trim()
    if (!name) { parsed.skipped.push({ line, name: '', reason: SKIP_NO_NAME }); continue }
    if (seen.has(name)) {
      parsed.duplicates++
      parsed.skipped.push({ line, name, reason: SKIP_DUPLICATE })
      continue
    }
    seen.add(name)

    parsed.rows.push({
      line, name, aliases: [],
      unit:      _cell(cols, mapping.unit),
      price:     _num(cols, mapping.price, { positive: true }),
      category:  _cell(cols, mapping.category),
      code:      _cell(cols, mapping.code),
      lotSize:   _cell(cols, mapping.lotSize),
      prevMonth: _cell(cols, mapping.prevMonth),
      tagsA:     _tagList(cols, mapping.axisA),
      tagsB:     _tagList(cols, mapping.axisB),
    })
  }

  if (parsed.rows.length === 0) throw new Error('有効な品目が見つかりませんでした')
  return parsed
}

// ── 割り当て（並び替え軸）の復元 ──────────────────────────────────────────────
// 優先度: ファイルの軸列 > 現在の割り当て > アーカイブ。返すだけで書き換えない。
function _planAssignments(order, current, fileTagsA, fileTagsB) {
  const a = {}, b = {}
  const restored = new Set()
  for (const nm of order) {
    const liveA = current.tagsA?.[nm],        liveB = current.tagsB?.[nm]
    const fA    = fileTagsA?.[nm],            fB    = fileTagsB?.[nm]
    const rA    = current.tagsArchiveA?.[nm], rB    = current.tagsArchiveB?.[nm]
    const av = fA !== undefined ? fA : liveA !== undefined ? liveA : rA
    const bv = fB !== undefined ? fB : liveB !== undefined ? liveB : rB
    if (av !== undefined) a[nm] = Array.isArray(av) ? [...av] : av
    if (bv !== undefined) b[nm] = Array.isArray(bv) ? [...bv] : bv
    if ((fA === undefined && liveA === undefined && rA !== undefined) ||
        (fB === undefined && liveB === undefined && rB !== undefined)) restored.add(nm)
  }
  return { tagsA: a, tagsB: b, restoredTags: restored.size }
}

// ── 差分 ──────────────────────────────────────────────────────────────────────
// dictionary は「別名 → 品目名」なので、品目名から別名を引く索引を1回だけ作る。
function _aliasIndex(dictionary) {
  const idx = new Map()
  for (const [alias, target] of Object.entries(dictionary ?? {})) {
    if (!idx.has(target)) idx.set(target, [])
    idx.get(target).push(alias)
  }
  for (const list of idx.values()) list.sort()
  return idx
}

function _fmt(v) {
  if (v === undefined || v === null || v === '') return ''
  if (Array.isArray(v)) return v.join('・')
  return String(v)
}

function _diffItem(name, current, next, beforeAliases, afterAliases) {
  const changes = []
  for (const f of DIFF_FIELDS) {
    const before = _fmt(current[f.map]?.[name])
    const after  = _fmt(next[f.map]?.[name])
    if (before !== after) changes.push({ field: f.label, before, after })
  }
  const ba = (beforeAliases.get(name) ?? []).join(',')
  const aa = (afterAliases.get(name)  ?? []).join(',')
  if (ba !== aa) changes.push({ field: 'エイリアス', before: ba, after: aa })
  for (const [key, label] of [['tagsA', '並び替え①'], ['tagsB', '並び替え②']]) {
    const before = _fmt(current[key]?.[name])
    const after  = _fmt(next[key]?.[name])
    if (before !== after) changes.push({ field: label, before, after })
  }
  return changes
}

/**
 * 解析結果と現在の品目マスタから「取込後の状態」と「差分」を組み立てる。
 * current は useConfig の config と同じ形（この関数は current を書き換えない）。
 *
 * @param {object}  parsed   parseItemCSV / parseMappedCSV の返り値
 * @param {object}  current  現在の品目マスタ
 * @param {object}  opts     { mode, itemLimit, axisNameMax }
 * @returns {object} 適用に必要な全マップ＋summary（件数と差分）
 */
export function buildImportPlan(parsed, current, opts = {}) {
  const {
    mode        = IMPORT_MODE_MERGE,
    itemLimit   = Infinity,     // Free プランの品目上限（Pro は Infinity）
    axisNameMax = 10,
  } = opts

  const isMerge = mode !== IMPORT_MODE_REPLACE
  const rows    = parsed.rows
  if (!rows.length) throw new Error('有効な品目が見つかりませんでした')

  const existingOrder = Array.isArray(current.order) ? [...current.order] : []
  const existingSet   = new Set(existingOrder)

  // 追加候補。マージでは既存に無い品目だけが「追加」になる。
  const incoming = rows.map(r => r.name)
  const newNames = isMerge ? incoming.filter(n => !existingSet.has(n)) : incoming

  // Free 上限。マージでは既存品目を絶対に削らず、入り切らない分だけを truncated として返す。
  const room = Number.isFinite(itemLimit)
    ? Math.max(0, itemLimit - (isMerge ? existingOrder.length : 0))
    : Infinity
  const acceptedNew   = newNames.length > room ? newNames.slice(0, room) : newNames
  const truncated     = newNames.length > room ? newNames.slice(room)    : []

  const order    = isMerge ? [...existingOrder, ...acceptedNew] : acceptedNew
  const orderSet = new Set(order)

  // マージは既存値から始め、ファイルにある値だけを上書きする（空欄は既存を消さない）。
  // 全入れ替えは空から組み立て直すので、ファイルに無い品目の属性は残らない。
  const next = isMerge
    ? {
        units:         { ...current.units },
        prices:        { ...current.prices },
        categories:    { ...current.categories },
        codes:         { ...current.codes },
        categoryCodes: { ...current.categoryCodes },
        prevMonths:    { ...current.prevMonths },
        lotSizes:      { ...current.lotSizes },
        reorderPoints: { ...current.reorderPoints },
        dictionary:    { ...current.dictionary },
      }
    : {
        units: {}, prices: {}, categories: {}, codes: {}, categoryCodes: {},
        prevMonths: {}, lotSizes: {}, dictionary: {},
        // 発注点列を持たないファイルでは既存の発注点を消さない（非破壊）
        reorderPoints: parsed.hasReorderColumn ? {} : { ...current.reorderPoints },
      }

  const fileTagsA = {}, fileTagsB = {}
  for (const row of rows) {
    if (!orderSet.has(row.name)) continue      // 上限を超えて入らなかった品目
    if (row.unit         !== undefined) next.units[row.name]      = row.unit
    if (row.price        !== undefined) next.prices[row.name]     = row.price
    if (row.category     !== undefined) next.categories[row.name] = row.category
    if (row.code         !== undefined) next.codes[row.name]      = row.code
    if (row.prevMonth    !== undefined) next.prevMonths[row.name] = row.prevMonth
    if (row.lotSize      !== undefined) next.lotSizes[row.name]   = row.lotSize
    if (row.categoryCode !== undefined && row.category) next.categoryCodes[row.category] = row.categoryCode
    if (parsed.hasReorderColumn) {
      if (row.reorderPoint === null) delete next.reorderPoints[row.name]
      else if (row.reorderPoint !== undefined) next.reorderPoints[row.name] = row.reorderPoint
    }
    for (const alias of row.aliases) next.dictionary[alias] = row.name
    if (row.tagsA !== undefined) fileTagsA[row.name] = row.tagsA
    if (row.tagsB !== undefined) fileTagsB[row.name] = row.tagsB
  }

  const { tagsA, tagsB, restoredTags } = _planAssignments(order, current, fileTagsA, fileTagsB)
  next.tagsA = tagsA
  next.tagsB = tagsB

  // 軸名が未設定なら、ファイルの列名を軸名に採用する
  const axisNames = [...(Array.isArray(current.axisNames) ? current.axisNames : ['', ''])]
  for (const i of [0, 1]) {
    const header = parsed.axisHeaders?.[i]
    if (header && !axisNames[i]) axisNames[i] = String(header).trim().slice(0, axisNameMax)
  }

  // 差分。全入れ替えでも「取込後の値 vs 現在の値」で判定するので、
  // 値が消える品目も「更新」として現れる。
  const beforeAliases = _aliasIndex(current.dictionary)
  const afterAliases  = _aliasIndex(next.dictionary)
  const added = [], updated = [], unchanged = []
  for (const row of rows) {
    if (!orderSet.has(row.name)) continue
    if (!existingSet.has(row.name)) { added.push(row.name); continue }
    const changes = _diffItem(row.name, current, next, beforeAliases, afterAliases)
    if (changes.length) updated.push({ name: row.name, changes })
    else unchanged.push(row.name)
  }
  const removed = isMerge ? [] : existingOrder.filter(n => !orderSet.has(n))

  return {
    mode: isMerge ? IMPORT_MODE_MERGE : IMPORT_MODE_REPLACE,
    order,
    ...next,
    axisNames,
    restoredTags,
    manualItems: (current.manualItems ?? []).filter(n => orderSet.has(n)),
    hasReorderColumn: parsed.hasReorderColumn,
    summary: {
      added, updated, unchanged, removed, truncated,
      skipped:    parsed.skipped,
      duplicates: parsed.duplicates,
      rows:       rows.length,
      total:      order.length,
    },
  }
}

/** プレビュー用に件数だけを取り出す（UIが毎回数え直さないため） */
export function summaryCounts(summary) {
  return {
    added:      summary.added.length,
    updated:    summary.updated.length,
    unchanged:  summary.unchanged.length,
    removed:    summary.removed.length,
    truncated:  summary.truncated.length,
    skipped:    summary.skipped.length,
    duplicates: summary.duplicates,
    total:      summary.total,
  }
}
