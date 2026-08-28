// server側の入力検証（DATA-001）。
//
// 方針: 「直せるものは直す」ではなく「業務契約に合わないものは拒否する」。
// 特に数量は、NaN / Infinity を 0 へ丸めない。在庫0と入力不能を同じ値にすると、
// 欠測が「棚に無い」として理論在庫・消費量の算出へそのまま伝播する。
//
// 文字列は従来どおり slice で切り詰める（既存データとの互換のため）。
// ID・日付・数量・件数は切り詰めず拒否する。

import {
  MAX_ID_LEN,
  D1_MAX_BOUND_PARAMS,
} from './constants.js'

/** ISO日付（YYYY-MM-DD）として妥当か。実在しない日付（2026-02-30）も弾く。 */
export function isValidDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * 日付を受け取る。未指定なら今日。形式不正は null（呼び出し側が400にする）。
 */
export function parseDate(v, today) {
  if (v == null || v === '') return today
  return isValidDate(v) ? v : null
}

/**
 * client採番ID。`[\w-]{1,64}` に限る（routerの正規表現と同じ形）。
 * 未指定なら null を返し、呼び出し側が crypto.randomUUID() を使う。
 * 不正な形は undefined を返して区別する。
 */
export function parseClientId(v) {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return undefined
  if (v.length > MAX_ID_LEN) return undefined
  return /^[\w-]+$/.test(v) ? v : undefined
}

/**
 * 数量。契約に合わなければ null を返す（呼び出し側が400にする）。
 * 文字列の数値表現は受け付けるが、空文字・NaN・Infinity・範囲外は拒否する。
 *
 * @param {*} v
 * @param {{ min: number, max: number }} range
 */
export function parseQty(v, { min, max }) {
  if (v === '' || v == null || typeof v === 'boolean') return null
  if (Array.isArray(v)) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null      // NaN / Infinity / -Infinity
  if (n < min || n > max) return null
  return n
}

/**
 * 任意の数値（単価・在庫数など）。未指定は null を許す。
 * 指定されていて非有限・範囲外なら undefined（=拒否）を返す。
 */
export function parseOptionalNumber(v, { min, max }) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  if (n < min || n > max) return undefined
  return n
}

/**
 * 列挙値。許可リストに無い値は undefined（=拒否）。未指定は null。
 * 「不正なら既定値へ倒す」をやめるための入口（movement type / session type）。
 */
export function parseEnum(v, allowed) {
  if (v == null || v === '') return null
  return allowed.includes(v) ? v : undefined
}

/**
 * 0以上の整数（件数）。未指定は null。非整数・負数・非有限は undefined（=拒否）。
 * 旧実装は `typeof === 'number'` 以外を黙って 0 にしていた。
 */
export function parseCount(v, max) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > max) return undefined
  return n
}

/** JSON化したときの UTF-8 バイト数。直列化できない値は Infinity（=拒否側へ倒す）。 */
export function jsonByteLength(body) {
  try {
    const json = JSON.stringify(body ?? {})
    if (typeof json !== 'string') return Infinity
    return new TextEncoder().encode(json).byteLength
  } catch (_) {
    return Infinity
  }
}

/** 文字列を trim して上限で切る。非文字列は空文字。 */
export function text(v, maxLen) {
  if (v == null) return ''
  return String(v).trim().slice(0, maxLen)
}

/**
 * 1文へまとめる行数から、bound parameter 上限を超えないことを確認する。
 * 定数の計算ミスを本番で踏まないための自己点検（テストからも使う）。
 */
export function assertParamBudget(rowsPerStatement, perRow, fixed) {
  const used = rowsPerStatement * perRow + fixed
  if (used > D1_MAX_BOUND_PARAMS) {
    throw new Error(`bound parameter budget exceeded: ${used} > ${D1_MAX_BOUND_PARAMS}`)
  }
  return used
}

/**
 * 複数行を1文へまとめるときの行ソース `(VALUES (?,?),(?,?)) v` を組み立てる。
 *
 * **`UNION ALL` を使わない**。実D1は `SELECT ? AS a UNION ALL ...` を19項でも
 * `too many terms in compound SELECT` で落とす（2026-08-28 に Pro Review 上で計測。
 * s19=NG / v1000=ok）。SQLite は複数行 VALUES を compound SELECT の項数制限から
 * 除外するため、同じ「複数行を1文へ」を VALUES 形式でやれば上限に当たらない。
 *
 * VALUES を FROM に置くと列名は `column1`, `column2`, … になる（SQLite の既定）。
 * 呼び出し側がその番号を数えなくて済むよう、列名 → 参照式の対応も返す。
 *
 * @param {number} rowCount まとめる行数
 * @param {string[]} columns 行の列名（VALUES の並び順）
 * @returns {{ sql: string, col: Record<string,string> }}
 */
export function valueRows(rowCount, columns) {
  const row = `(${columns.map(() => '?').join(', ')})`
  return {
    sql: Array.from({ length: rowCount }, () => row).join(', '),
    col: Object.fromEntries(columns.map((name, i) => [name, `v.column${i + 1}`])),
  }
}

/** 配列を size ごとに分ける（明細INSERTのまとめ単位）。 */
export function chunk(rows, size) {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}
