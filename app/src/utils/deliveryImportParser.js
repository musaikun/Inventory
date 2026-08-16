// 納品履歴の一括取込「中間フォーマット」CSV パーサ。
// 形式（列順は自由・ヘッダ名で特定）:
//   日付, 種別, 仕入先, カテゴリ, 品目名, 数量, 単位, 単価, 商品コード, 入数
// 各行に日付があるため 1ファイルで複数日ぶんを投入できる。
// resultCsvParser と同じくヘッダ表記ゆれを許容する。
//
// 出力行: { date, type, supplier, category, name, qty, unit, price, code, lotSize }
//   date は 'YYYY-MM-DD' に正規化。type は 'in'（既定）| 'out'。

import { tokenizeCSV, readNumericCell, toCSVRow, parseCSVLine as _line } from './csvParse.js'
import { normalizeImportDate } from './importDate.js'
import { IMPORT_MAX_MOVEMENT_QTY, IMPORT_MAX_UNIT_PRICE } from './importLimits.js'

// 字句解析は utils/csvParse.js と共用する（3つの取込経路で1つの解釈にそろえる）。
const parseCSVLine = (line) => _line(line).map(s => s.trim())

// ファイル全体をレコードへ分解する。未閉じ引用符は黙って受理せず throw する。
function _records(csvText) {
  const { rows, error } = tokenizeCSV(csvText)
  if (error) throw Object.assign(new Error(error.message), { code: error.code, line: error.line })
  return rows.map(r => ({ line: r.line, cols: r.cols.map(c => c.trim()) }))
}

// ヘッダ候補（表記ゆれを許容）。種別(type)とカテゴリ(category)は語を分けて誤検出を防ぐ。
const COLS = {
  date:     ['日付', '納品日', '入荷日', '伝票日付', '取引日', 'date'],
  type:     ['種別', '区分', '入出庫', 'type'],
  supplier: ['仕入先', '業者', '取引先', 'メーカー', 'ベンダー', 'supplier'],
  category: ['カテゴリ', '分類', 'ジャンル', '部門', '品目分類'],
  name:     ['品目名', '商品名', '品名', '名称', 'item'],
  qty:      ['数量', '入荷数', '納品数', '数', 'qty'],
  unit:     ['単位', 'unit'],
  price:    ['単価', '原価', '仕入単価', '仕入価格', 'price'],
  code:     ['商品コード', 'コード', '品番', 'jan', 'ean'],
  lotSize:  ['入数', '入り数', 'ロット', 'ケース入数', 'lot'],
}

function _findCol(header, names) {
  const lower = header.map(h => h.toLowerCase())
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

// 種別を 'in' | 'out' に正規化。出庫系のみ out、それ以外（入庫/入荷/納品/仕入/空）は in。
export function normalizeType(s) {
  const t = (s ?? '').trim()
  if (/出庫|出荷|廃棄|ロス|返品|out/i.test(t)) return 'out'
  return 'in'
}

// 日付を 'YYYY-MM-DD' に正規化。解釈できない・実在しない日は ''。
// 受理: 2026-06-01 / 2026/6/1 / 2026.6.1 / 2026年6月1日
//
// 実装は utils/importDate.js（棚卸結果取込と共用）。月日の範囲だけを見ていた頃は
// `2026-02-30` や平年の `2025-02-29` がそのまま通っていた。
// 既存の呼び出し元のために export 名はそのまま残す。
export function normalizeDate(s) {
  return normalizeImportDate(s)
}

// この CSV が中間フォーマットとして解釈可能か（日付・品目名・数量列がある）。
export function isDeliveryImportCSV(csvText) {
  const firstLine = (csvText ?? '').replace(/^﻿/, '').split(/\r?\n/)[0] ?? ''
  if (!firstLine) return false
  const header = parseCSVLine(firstLine)
  return _findCol(header, COLS.date) >= 0 &&
         _findCol(header, COLS.name) >= 0 &&
         _findCol(header, COLS.qty) >= 0
}

/**
 * 中間フォーマットCSVを解析して正規化行を返す。
 * @returns {{ rows: Array, skipped: number, total: number, errors: Array }}
 *   rows    = 有効行 [{ date, type, supplier, category, name, qty, unit, price, code, lotSize }]
 *   skipped = 日付・品目名・数量が**空**で捨てた行数（未入力）
 *   total   = データ行数（ヘッダを除く非空行）
 *   errors  = 書いてあるのに読めない行 [{ line, column, columnLabel, value, reason, name }]
 * 構造不正（必須列なし・データ行なし）は throw。
 *
 * 数値の読み方は品目取込・棚卸結果取込と同じ契約（csvParse.readNumericCell）を使う。
 * `parseFloat` の前方一致受理をやめたので、`12abc` `1,20` `-100` `abc100` は
 * 黙って正常値へ寄らず、行番号・列名・元の値・理由つきで画面へ出る。
 */
export function parseDeliveryImportCSV(csvText) {
  const records = _records(csvText)
  if (records.length < 2) throw new Error('データ行がありません')

  const header = records[0].cols
  const ci = {
    date:     _findCol(header, COLS.date),
    type:     _findCol(header, COLS.type),
    supplier: _findCol(header, COLS.supplier),
    category: _findCol(header, COLS.category),
    name:     _findCol(header, COLS.name),
    qty:      _findCol(header, COLS.qty),
    unit:     _findCol(header, COLS.unit),
    price:    _findCol(header, COLS.price),
    code:     _findCol(header, COLS.code),
    lotSize:  _findCol(header, COLS.lotSize),
  }
  if (ci.date < 0 || ci.name < 0 || ci.qty < 0) {
    throw new Error('納品取込CSVの形式ではありません（「日付」「品目名」「数量」列が必要です）')
  }

  const _cell = (cols, i) => i >= 0 ? (cols[i] ?? '').trim() : ''
  const label = (i, fallback) => (header[i] ?? '').trim() || fallback
  const rows   = []
  const errors = []
  let skipped = 0
  let total = 0

  for (const { line, cols } of records.slice(1)) {
    const name    = (cols[ci.name] ?? '').trim()
    const dateRaw = (cols[ci.date] ?? '').trim()
    const date    = normalizeDate(cols[ci.date])
    const qtyRaw  = (cols[ci.qty] ?? '').trim()

    // 合計行など明らかな非データ行はカウントせず読み飛ばす
    if (!name && !dateRaw && qtyRaw === '') continue
    if (name === '【合計】' || name === '合計') continue
    total++

    // 未入力（空欄）は「不備でスキップ」、書いてあるのに読めない値は「エラー」に分ける。
    if (!name || !dateRaw || qtyRaw === '') { skipped++; continue }

    if (!date) {
      errors.push({
        line, column: ci.date, columnLabel: label(ci.date, '日付'), value: dateRaw, name,
        reason: `日付「${dateRaw}」を YYYY-MM-DD として読めません`,
      })
      continue
    }

    const qty = readNumericCell(cols[ci.qty], {
      line, column: ci.qty, columnLabel: label(ci.qty, '数量'),
      positive: true, max: IMPORT_MAX_MOVEMENT_QTY,
    })
    if (qty.error) { errors.push({ ...qty.error, name }); continue }

    let priceVal = null
    if (ci.price >= 0) {
      const p = readNumericCell(cols[ci.price], {
        line, column: ci.price, columnLabel: label(ci.price, '単価'),
        positive: true, max: IMPORT_MAX_UNIT_PRICE,
      })
      if (p.error) { errors.push({ ...p.error, name }); continue }
      priceVal = p.value ?? null
    }

    rows.push({
      date,
      type:     normalizeType(cols[ci.type]),
      supplier: _cell(cols, ci.supplier),
      category: _cell(cols, ci.category),
      name,
      qty:      qty.value,
      unit:     _cell(cols, ci.unit),
      price:    priceVal,
      code:     _cell(cols, ci.code),
      lotSize:  _cell(cols, ci.lotSize),
    })
  }

  if (rows.length === 0 && errors.length === 0) throw new Error('取り込める納品データが見つかりませんでした')
  return { rows, skipped, total, errors }
}

// 中間フォーマットのテンプレCSV文字列（ダウンロード用・見本行つき）。
export function deliveryImportTemplateCSV() {
  // 見本の値も共通エスケープを通す（カンマ・引用符を含む品目名でも壊れないテンプレにする）
  const header = ['日付', '種別', '仕入先', 'カテゴリ', '品目名', '数量', '単位', '単価', '商品コード', '入数']
  const examples = [
    ['2026-06-01', '入庫', '八百屋青果', '野菜', '玉ねぎ',   '20', 'kg', '190', '', '10'],
    ['2026-06-01', '入庫', '肉のヤマ',   '肉',   '鶏もも',   '5',  'kg', '980', '', '1'],
    ['2026-06-03', '入庫', '八百屋青果', '野菜', 'レタス',   '24', '玉', '100', '', '8'],
  ]
  return [header, ...examples].map(cells => toCSVRow(cells)).join('\r\n')
}
