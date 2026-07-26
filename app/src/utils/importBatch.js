// 納品取込の冪等性ユーティリティ。責務: 同じ納品を二度取り込んでも二重にならないよう、
// 「日付+種別+品目+数量」の内容キーで重複を検知する。純関数・副作用なし。
//
// 重複判定は既存の入出庫レコード（手入力・発注取込・過去取込すべて）に対して行う。
// バッチ内の同一行どうしの重複も同時に検知する。

// 数量を正規化（3 と 3.0、"3" と 3 を同一視）。
function _q(qty) {
  const n = Number(qty)
  return Number.isFinite(n) ? String(n) : ''
}

// 1明細の内容キー。date/type/item/qty から生成。
export function lineKey({ date, type = 'in', item, qty }) {
  return `${date ?? ''}|${type === 'out' ? 'out' : 'in'}|${(item ?? '').trim()}|${_q(qty)}`
}

// 既存の入出庫レコード配列から、全明細の内容キー集合を作る。
export function existingLineKeys(movements = []) {
  const set = new Set()
  for (const m of movements) {
    for (const l of (m?.lines || [])) {
      set.add(lineKey({ date: m.date, type: m.type, item: l.item, qty: l.qty }))
    }
  }
  return set
}

// 取込行に duplicate フラグを付ける。既存キーとの衝突＋バッチ内の重複を検知。
//   row.name を品目名として使う（未解決の生の名前）。
//   解決後の品目名でも判定したい場合は itemOf(row) を渡す。
// @returns {{ rows: Array, duplicateCount: number }}
export function annotateDuplicates(rows = [], existingKeys = new Set(), itemOf = r => r.name) {
  const seen = new Set()
  let duplicateCount = 0
  const out = rows.map(row => {
    const key = lineKey({ date: row.date, type: row.type, item: itemOf(row), qty: row.qty })
    const duplicate = existingKeys.has(key) || seen.has(key)
    if (duplicate) duplicateCount++
    else seen.add(key)
    return { ...row, duplicate }
  })
  return { rows: out, duplicateCount }
}

// 取込バッチID（一括取消・再取込の追跡用）。
export function newImportBatchId() {
  return 'imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
