// 棚卸結果CSV（エクスポートしたもの）から、入力復元用に品目名・数量・単位・コードを抽出する。
// 形式: 日付,商品コード,品目名,単位,数量[,単価,在庫金額]
// ヘッダ名で列を特定するため、列順が多少違っても動く。

function parseCSVLine(line) {
  const out = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim())
}

// ヘッダ候補（表記ゆれを許容）
const COLS = {
  name:      ['品目名', '商品名', '品名', '名称'],
  qty:       ['数量', '在庫数', '棚卸数'],
  unit:      ['単位'],
  code:      ['商品コード', 'コード', 'jan', 'ean'],
  price:     ['単価', '原価'],
  category:  ['カテゴリ', '分類', '種別', 'ジャンル'],
  lotSize:   ['入数', '入り数', 'ロット'],
  prevMonth: ['前月実績', '前月', '先月'],
}

function _findCol(header, names) {
  const lower = header.map(h => h.toLowerCase())
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

// この CSV が棚卸結果CSVとして解釈可能か（品目名列と数量列がある）
export function isResultCSV(csvText) {
  const firstLine = (csvText ?? '').replace(/^﻿/, '').split(/\r?\n/)[0] ?? ''
  if (!firstLine) return false
  const header = parseCSVLine(firstLine)
  return _findCol(header, COLS.name) >= 0 && _findCol(header, COLS.qty) >= 0
}

// 復元用の行配列を返す: [{ name, qty, unit, code, price, category, lotSize, prevMonth }]
// 数量が空・【合計】行・品目名が空の行はスキップする。
export function parseResultCSV(csvText) {
  const text  = (csvText ?? '').replace(/^﻿/, '').trim()
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('データ行がありません')

  const header = parseCSVLine(lines[0])
  const ci = {
    name:      _findCol(header, COLS.name),
    qty:       _findCol(header, COLS.qty),
    unit:      _findCol(header, COLS.unit),
    code:      _findCol(header, COLS.code),
    price:     _findCol(header, COLS.price),
    category:  _findCol(header, COLS.category),
    lotSize:   _findCol(header, COLS.lotSize),
    prevMonth: _findCol(header, COLS.prevMonth),
  }
  if (ci.name < 0 || ci.qty < 0) {
    throw new Error('棚卸結果CSVの形式ではありません（「品目名」「数量」列が必要です）')
  }

  const _cell = (cols, i) => i >= 0 ? (cols[i] ?? '').trim() : ''
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const name = (cols[ci.name] ?? '').trim()
    if (!name || name === '【合計】' || name === '合計') continue

    const qtyRaw = (cols[ci.qty] ?? '').replace(/,/g, '').trim()
    if (qtyRaw === '') continue
    const qty = parseFloat(qtyRaw)
    if (isNaN(qty)) continue

    rows.push({
      name,
      qty,
      unit:      _cell(cols, ci.unit),
      code:      _cell(cols, ci.code),
      price:     ci.price >= 0 ? (() => { const p = parseFloat((cols[ci.price] ?? '').replace(/,/g, '')); return isNaN(p) ? null : p })() : null,
      category:  _cell(cols, ci.category),
      lotSize:   _cell(cols, ci.lotSize),
      prevMonth: _cell(cols, ci.prevMonth),
    })
  }

  if (rows.length === 0) throw new Error('復元できる数量データが見つかりませんでした')
  return rows
}
