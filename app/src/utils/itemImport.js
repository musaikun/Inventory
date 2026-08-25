/**
 * 品目マスタ取込のロジック（状態を持たない純粋関数）。
 *
 * 取込は「解析 → 計画 → 適用」の3段に分かれる。
 *   parse*  … ファイルを行の中間表現へ。取り込めない行は行番号・列・理由を残す
 *   buildImportPlan … 現在の品目マスタ＋解析結果から「取込後の状態」と「差分」を組み立てる
 *   （適用は useConfig.js 側。ここでは何も書き換えない）
 *
 * 計画が状態を書き換えないので、取込前プレビューと実際の取込で必ず同じ結果になる。
 * プレビューで作った計画をそのまま適用する（同じ入力から2回組み立て直さない）。
 *
 * CSV の字句解析と数値の読み方は utils/csvParse.js に一本化してある。
 */

import { tokenizeCSV, readNumericCell, parseCSVLine as _parseCSVLine } from './csvParse.js'
import { IMPORT_MAX_REORDER_POINT, IMPORT_MAX_UNIT_PRICE } from './importLimits.js'

export const IMPORT_MODE_MERGE   = 'merge'    // 追加・更新（既定）。ファイルに無い既存品目は残す
export const IMPORT_MODE_REPLACE = 'replace'  // 全入れ替え。ファイルに無い既存品目は削除する

// エイリアス衝突の解決方法。既定は「既存を守る」＝黙って奪わない。
export const ALIAS_KEEP_EXISTING = 'keep'      // 既存品目のエイリアスをそのまま残す
export const ALIAS_TAKEOVER      = 'takeover'  // ファイルの指定を優先して付け替える

// 品目名の長さ上限（worker の MAX_INGREDIENT_LEN と揃える）
export const ITEM_NAME_MAX = 200

// 解析エラーのコード（UI が文言と次の操作を選ぶために使う）
export const IMPORT_ERROR_NO_HEADER     = 'no_header'
export const IMPORT_ERROR_NO_VALID_ROWS = 'no_valid_rows'

/**
 * 取り込める行が1件も無いときの例外。
 *
 * 「1件も取り込めなかった」だけを投げると、なぜ取り込めなかったのかが画面から消える。
 * 除外・エラーの明細を例外へ載せて、プレビューが行番号・列・理由を出せるようにする。
 */
function _noValidRowsError(parsed) {
  return Object.assign(new Error('有効な品目が見つかりませんでした'), {
    code:    IMPORT_ERROR_NO_VALID_ROWS,
    errors:  parsed.errors,
    skipped: parsed.skipped,
  })
}

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

// ヘッダ行の1列目に現れうる「品目名」列の呼び方。
// 先頭行がこのどれでもないファイルは、ヘッダ無しとして扱って列指定を促す
// （先頭行を黙ってヘッダ扱いにすると、1品目目が取り込まれずに消える）。
const NAME_HEADERS = ['品目名', '商品名', '品名', '名称', 'item', 'itemname', 'name']

/** 1行だけをセルへ分解する（csvParse の再公開。既存の呼び出し元との互換のため残す） */
export const parseCSVLine = _parseCSVLine

/** 先頭行がヘッダ行として使えるか（1列目が「品目名」相当か） */
export function looksLikeHeaderRow(cols) {
  const first = String(cols?.[0] ?? '').trim().toLowerCase().replace(/\s+/g, '')
  return NAME_HEADERS.includes(first)
}

function _cellAt(cols, idx) {
  if (idx === null || idx === undefined || idx < 0) return undefined
  const v = cols[idx]
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function _tagList(cols, idx) {
  const s = _cellAt(cols, idx)
  if (s === undefined) return undefined
  const arr = s.split('|').map(x => x.trim()).filter(Boolean)
  return arr.length ? [...new Set(arr)] : undefined
}

function _emptyParsed() {
  return {
    rows: [], skipped: [], errors: [], truncatedNames: [],
    duplicates: 0, hasReorderColumn: false, headers: [], axisHeaders: [null, null],
  }
}

/**
 * 数値セルを読む。空欄・不正・範囲外を呼び出し側が区別できる形で返す。
 * 判定そのものは csvParse.readNumericCell（全取込入口の共通契約）に任せ、
 * 不正値を「未指定（＝既存値を維持）」へすり替えないことだけをここで守る。
 */
function _numCell(cols, idx, opts = {}) {
  if (idx === null || idx === undefined || idx < 0) return { empty: true }
  return readNumericCell(cols[idx], { column: idx, ...opts })
}

/**
 * 行を1件組み立てる。列の読み取りで1つでも不正があれば、その行はエラーとして返す。
 * （不正な単価を黙って捨てて他の列だけ取り込むと、画面の「更新」と実データがずれる）
 */
function _buildRow({ line, cols, spec, headers }) {
  const errors = []
  const label = (idx, fallback) => headers?.[idx]?.trim() || fallback

  const num = (idx, fallback, opts) => {
    const r = _numCell(cols, idx, { line, columnLabel: label(idx, fallback), ...opts })
    if (r.error) errors.push(r.error)
    return r
  }

  const row = { line, aliases: [] }

  if (spec.unit      !== undefined) row.unit      = _cellAt(cols, spec.unit)
  if (spec.category  !== undefined) row.category  = _cellAt(cols, spec.category)
  if (spec.code      !== undefined) row.code      = _cellAt(cols, spec.code)
  if (spec.prevMonth !== undefined) row.prevMonth = _cellAt(cols, spec.prevMonth)
  if (spec.lotSize   !== undefined) row.lotSize   = _cellAt(cols, spec.lotSize)
  if (spec.axisA     !== undefined) row.tagsA     = _tagList(cols, spec.axisA)
  if (spec.axisB     !== undefined) row.tagsB     = _tagList(cols, spec.axisB)

  if (spec.price !== undefined) {
    const r = num(spec.price, '単価', { positive: true, max: IMPORT_MAX_UNIT_PRICE })
    if (r.value !== undefined) row.price = r.value
  }
  if (spec.categoryCode !== undefined) {
    // 分類コードは worker 側に数値契約が無いので、上限を勝手に足さない
    const r = num(spec.categoryCode, '分類コード')
    if (r.value !== undefined) row.categoryCode = r.value
  }
  if (spec.reorderPoint !== undefined && spec.reorderPoint >= 0) {
    const r = num(spec.reorderPoint, '発注点', { max: IMPORT_MAX_REORDER_POINT })
    // 発注点列があるとき、空欄は「解除」を意味する。undefined（列なし）と区別して null にする。
    row.reorderPoint = r.empty ? null : (r.value ?? null)
  }

  return { row, errors }
}

/** 行を1本のパイプラインで詰める。ヘッダ解釈以外は推奨形式も列指定も同じ扱いにする。 */
function _collectRows({ records, parsed, spec, headers }) {
  const seen = new Set()

  for (const { line, cols } of records) {
    if (headers.length && cols.length !== headers.length) {
      parsed.errors.push({
        line, column: null, columnLabel: '列数',
        value: `${cols.length}列`,
        reason: `列数がヘッダ（${headers.length}列）と一致しません`,
      })
      continue
    }

    const rawName = _cellAt(cols, spec.name)
    if (!rawName) { parsed.skipped.push({ line, name: '', reason: SKIP_NO_NAME }); continue }

    let name = rawName
    if (name.length > ITEM_NAME_MAX) {
      name = name.slice(0, ITEM_NAME_MAX)
      parsed.truncatedNames.push({ line, before: rawName, after: name })
    }

    if (seen.has(name)) {
      parsed.duplicates++
      parsed.skipped.push({ line, name, reason: SKIP_DUPLICATE })
      continue
    }

    const { row, errors } = _buildRow({ line, cols, spec, headers })
    if (errors.length) { parsed.errors.push(...errors.map(e => ({ ...e, name }))); continue }

    seen.add(name)
    row.name = name
    parsed.rows.push(row)
  }
}

/** ファイル全体をレコードへ分解し、共通のエラー条件をここで throw する */
function _records(csvText) {
  const { rows, error } = tokenizeCSV(csvText)
  if (error) throw Object.assign(new Error(error.message), { code: error.code, line: error.line })
  if (rows.length < 2) throw new Error('データ行がありません')
  return rows
}

/**
 * 棚卸品目 CSV の解析（品目名,単位,単価,カテゴリ,エイリアス,…）。
 * 推奨フォーマット（exportConfigCSV の出力）に加え、旧2/3/4列フォーマットも受け付ける。
 *
 * 先頭行がヘッダでないファイルは throw する。黙ってヘッダ扱いにすると先頭の品目が消えるため、
 * 呼び出し側は列指定（parseMappedCSV）へ誘導する。
 */
export function parseItemCSV(csvText) {
  const records = _records(csvText)

  const headers = records[0].cols.map(h => h.trim())
  if (!looksLikeHeaderRow(headers)) {
    throw Object.assign(
      new Error('1行目が見出し行ではありません。列を指定して取り込んでください（先頭の品目を見出しとして捨てないため）'),
      { code: IMPORT_ERROR_NO_HEADER },
    )
  }

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

  // 別名（エイリアス）は取り込まない。
  //
  // 列は位置で決めているのに、5列目が「エイリアス」かどうかを列名で確かめていなかった。
  // 5列目が別の意味を持つファイル（規格・旧品名など）では、その値が全行の別名として
  // 読まれ、1つの値を多数の品目が取り合う＝全件衝突になっていた（実データで1093件）。
  // 別名は voice 入力の名寄せにしか効かないのに、取込のたびに大量の選択を強いる。
  //
  // 既存の別名（config.dictionary）は消さない。ここでは「ファイルから増やさない」だけ。
  const spec = { name: 0, reorderPoint: reorderIdx }
  if (isOldFormat) {
    // 旧2列フォーマットは 品目名 + エイリアス だったので、品目名だけを読む
  } else if (hasCategoryCol) {
    Object.assign(spec, {
      unit: 1, price: 2, category: 3, code: 5,
      categoryCode: 6, prevMonth: 7, lotSize: 8, axisA: axisAIdx, axisB: axisBIdx,
    })
  } else if (hasPriceCol) {
    Object.assign(spec, { unit: 1, price: 2 })
  } else {
    Object.assign(spec, { unit: 1 })
  }

  _collectRows({ records: records.slice(1), parsed, spec, headers })

  if (parsed.rows.length === 0) throw _noValidRowsError(parsed)
  return parsed
}

/**
 * 任意CSVをフィールドマッピング指定で解析。
 * mapping = { name, unit, price, category, code, lotSize, prevMonth, axisA, axisB }（null=使用しない）
 *
 * @param {object} [opts]
 * @param {boolean} [opts.hasHeader=true] false なら1行目もデータ行として扱う（ヘッダ無しファイル）
 */
export function parseMappedCSV(csvText, mapping = {}, { hasHeader = true } = {}) {
  const nameCol = mapping.name
  if (nameCol === null || nameCol === undefined) throw new Error('品目名列を選択してください')

  const { rows: records, error } = tokenizeCSV(csvText)
  if (error) throw Object.assign(new Error(error.message), { code: error.code, line: error.line })
  if (records.length < (hasHeader ? 2 : 1)) throw new Error('データ行がありません')

  const headers = hasHeader ? records[0].cols.map(h => h.trim()) : []
  const parsed  = _emptyParsed()
  parsed.headers     = headers
  parsed.axisHeaders = [
    mapping.axisA != null ? (headers[mapping.axisA] ?? null) : null,
    mapping.axisB != null ? (headers[mapping.axisB] ?? null) : null,
  ]

  const spec = { name: nameCol }
  for (const k of ['unit', 'price', 'category', 'code', 'lotSize', 'prevMonth', 'axisA', 'axisB']) {
    if (mapping[k] != null && mapping[k] >= 0) spec[k] = mapping[k]
  }

  _collectRows({
    records: hasHeader ? records.slice(1) : records,
    parsed, spec,
    // ヘッダ無しでは列数の基準が無いので、列数不一致の判定はしない
    headers: hasHeader ? headers : [],
  })

  if (parsed.rows.length === 0) throw _noValidRowsError(parsed)
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
 * エイリアスの割り当てを決める。
 *
 * 既存の別名が別の品目を指している場合、取込側が黙って奪うと「別名で検索したら
 * 知らない品目が出る」状態になる。既定（ALIAS_KEEP_EXISTING）では奪わず、
 * 衝突として返して画面に出す。ALIAS_TAKEOVER が明示されたときだけ付け替える。
 *
 * 品目名そのものと同じ別名（既存品目を隠してしまう）も衝突として扱う。
 *
 * 現在、取込は別名を1件も持ち込まない（parseItemCSV が読まない）ため、この関数は
 * 既存の別名をそのまま次の状態へ引き継ぐだけになる。衝突解決の規則は、別名の取込を
 * 復活させるときのために残してある。
 *
 * 衝突は3種で、**どちらの選択でも「画面の文言どおり」の結果**にする。
 *   existing … 既存の別名が別品目を指す。keep=既存を維持 / takeover=ファイルへ付け替え
 *   item     … 別名が既存の品目名と同じ。keep=品目を隠さない / takeover=ファイルへ付け替え
 *   file     … ファイル内で2品目が同じ別名を取り合う。
 *              keep=ファイルの**先頭行**を維持 / takeover=**あとの行**へ付け替える
 *              （「ファイルの指定を優先する」を選んだのに先頭行だけが残ると、
 *                画面の説明と結果がずれるため、ファイル内衝突も同じ規則で動かす）
 */
function _planAliases({ rows, orderSet, baseDictionary, removedSet, policy }) {
  const dictionary = { ...baseDictionary }
  const conflicts  = []
  const claimed    = new Map()   // alias -> 今回のファイルで採用済みの品目
  const takeover   = policy === ALIAS_TAKEOVER

  for (const row of rows) {
    if (!orderSet.has(row.name)) continue
    for (const alias of row.aliases) {
      const currentOwner = baseDictionary[alias]
      const fileOwner    = claimed.get(alias)

      // 同じ別名をファイル内の2品目が取り合っている
      if (fileOwner && fileOwner !== row.name) {
        conflicts.push({ alias, from: fileOwner, to: row.name, line: row.line, kind: 'file' })
        if (!takeover) continue
      } else if (orderSet.has(alias) && alias !== row.name) {
        // 既存品目の名前を別名にすると、その品目が検索から隠れる
        conflicts.push({ alias, from: alias, to: row.name, line: row.line, kind: 'item' })
        if (!takeover) continue
      } else if (currentOwner && currentOwner !== row.name && !removedSet.has(currentOwner)) {
        // 既存の別名が別の品目を指している
        conflicts.push({ alias, from: currentOwner, to: row.name, line: row.line, kind: 'existing' })
        if (!takeover) continue
      }

      dictionary[alias] = row.name
      claimed.set(alias, row.name)
    }
  }

  return { dictionary, aliasConflicts: conflicts }
}

/**
 * 解析結果と現在の品目マスタから「取込後の状態」と「差分」を組み立てる。
 * current は useConfig の config と同じ形（この関数は current を書き換えない）。
 *
 * @param {object}  parsed   parseItemCSV / parseMappedCSV の返り値
 * @param {object}  current  現在の品目マスタ
 * @param {object}  opts     { mode, itemLimit, axisNameMax, aliasPolicy }
 * @returns {object} 適用に必要な全マップ＋summary（件数と差分）
 */
export function buildImportPlan(parsed, current, opts = {}) {
  const {
    mode        = IMPORT_MODE_MERGE,
    itemLimit   = Infinity,     // Free プランの品目上限（Pro は Infinity）
    axisNameMax = 10,
    aliasPolicy = ALIAS_KEEP_EXISTING,
  } = opts

  const isMerge = mode !== IMPORT_MODE_REPLACE
  const rows    = parsed.rows
  if (!rows.length) throw _noValidRowsError(parsed)

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
  const removed  = isMerge ? [] : existingOrder.filter(n => !orderSet.has(n))

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
      }
    : {
        units: {}, prices: {}, categories: {}, codes: {}, categoryCodes: {},
        prevMonths: {}, lotSizes: {},
        // 発注点列を持たないファイルでは既存の発注点を消さない（非破壊）
        reorderPoints: parsed.hasReorderColumn ? {} : { ...current.reorderPoints },
      }

  // 全入れ替えでも、消える品目を指していた別名は落とす。残す別名を土台にして衝突を判定する。
  const baseDictionary = isMerge
    ? { ...current.dictionary }
    : Object.fromEntries(
        Object.entries(current.dictionary ?? {}).filter(([, target]) => orderSet.has(target)),
      )

  const fileTagsA = {}, fileTagsB = {}
  const categoryCodeChanges = []
  for (const row of rows) {
    if (!orderSet.has(row.name)) continue      // 上限を超えて入らなかった品目
    if (row.unit      !== undefined) next.units[row.name]      = row.unit
    if (row.price     !== undefined) next.prices[row.name]     = row.price
    if (row.category  !== undefined) next.categories[row.name] = row.category
    if (row.code      !== undefined) next.codes[row.name]      = row.code
    if (row.prevMonth !== undefined) next.prevMonths[row.name] = row.prevMonth
    if (row.lotSize   !== undefined) next.lotSizes[row.name]   = row.lotSize
    if (row.categoryCode !== undefined && row.category) next.categoryCodes[row.category] = row.categoryCode
    if (parsed.hasReorderColumn) {
      if (row.reorderPoint === null) delete next.reorderPoints[row.name]
      else if (row.reorderPoint !== undefined) next.reorderPoints[row.name] = row.reorderPoint
    }
    if (row.tagsA !== undefined) fileTagsA[row.name] = row.tagsA
    if (row.tagsB !== undefined) fileTagsB[row.name] = row.tagsB
  }

  // 分類コードはカテゴリ単位（品目単位の差分に出ないので、別立てで見せる）
  for (const [category, code] of Object.entries(next.categoryCodes)) {
    const before = current.categoryCodes?.[category]
    if (before !== code) categoryCodeChanges.push({ category, before: before ?? null, after: code })
  }
  for (const category of Object.keys(current.categoryCodes ?? {})) {
    if (!(category in next.categoryCodes)) {
      categoryCodeChanges.push({ category, before: current.categoryCodes[category], after: null })
    }
  }

  const { dictionary, aliasConflicts } = _planAliases({
    rows, orderSet, baseDictionary, removedSet: new Set(removed), policy: aliasPolicy,
  })
  next.dictionary = dictionary

  const { tagsA, tagsB, restoredTags } = _planAssignments(order, current, fileTagsA, fileTagsB)
  next.tagsA = tagsA
  next.tagsB = tagsB

  // 軸名が未設定なら、ファイルの列名を軸名に採用する
  const axisNames = [...(Array.isArray(current.axisNames) ? current.axisNames : ['', ''])]
  const axisNameChanges = []
  for (const i of [0, 1]) {
    const header = parsed.axisHeaders?.[i]
    if (header && !axisNames[i]) {
      const adopted = String(header).trim().slice(0, axisNameMax)
      axisNames[i] = adopted
      axisNameChanges.push({ index: i, before: '', after: adopted, source: String(header).trim() })
    }
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

  return {
    mode: isMerge ? IMPORT_MODE_MERGE : IMPORT_MODE_REPLACE,
    aliasPolicy,
    order,
    ...next,
    axisNames,
    restoredTags,
    manualItems: (current.manualItems ?? []).filter(n => orderSet.has(n)),
    hasReorderColumn: parsed.hasReorderColumn,
    summary: {
      added, updated, unchanged, removed, truncated,
      skipped:        parsed.skipped,
      errors:         parsed.errors ?? [],
      truncatedNames: parsed.truncatedNames ?? [],
      aliasConflicts,
      categoryCodeChanges,
      axisNameChanges,
      duplicates: parsed.duplicates,
      rows:       rows.length,
      total:      order.length,
      // 発注点列を持つファイルだけが発注点を書き換える。持たなければ既存を保持する。
      reorderPointsFromFile: parsed.hasReorderColumn,
      reorderPointsCleared:  parsed.hasReorderColumn
        ? rows.filter(r => orderSet.has(r.name) && r.reorderPoint === null
            && current.reorderPoints?.[r.name] !== undefined).map(r => r.name)
        : [],
    },
  }
}

/** プレビュー用に件数だけを取り出す（UIが毎回数え直さないため） */
export function summaryCounts(summary) {
  return {
    added:          summary.added.length,
    updated:        summary.updated.length,
    unchanged:      summary.unchanged.length,
    removed:        summary.removed.length,
    truncated:      summary.truncated.length,
    skipped:        summary.skipped.length,
    errors:         (summary.errors ?? []).length,
    aliasConflicts: (summary.aliasConflicts ?? []).length,
    truncatedNames: (summary.truncatedNames ?? []).length,
    duplicates:     summary.duplicates,
    total:          summary.total,
  }
}
