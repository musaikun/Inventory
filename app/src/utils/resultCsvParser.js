// 棚卸結果CSV（エクスポートしたもの）から、入力復元用に品目名・数量・単位・コードを抽出する。
// 形式: 日付,商品コード,品目名,単位,数量[,単価,在庫金額]
// ヘッダ名で列を特定するため、列順が多少違っても動く。

import { tokenizeCSV, readNumericCell, parseCSVLine as _line } from './csvParse.js'

// 字句解析は utils/csvParse.js と共用する（エスケープされた引用符・未閉じ引用符・
// 引用符内の改行の扱いを、品目取込と棚卸結果取込で1つにするため）。
const parseCSVLine = (line) => _line(line).map(s => s.trim())

// ファイル全体をレコードへ分解する。未閉じ引用符は黙って受理せず throw する。
function _records(csvText) {
  const { rows, error } = tokenizeCSV(csvText)
  if (error) throw Object.assign(new Error(error.message), { code: error.code, line: error.line })
  return rows.map(r => ({ line: r.line, cols: r.cols.map(c => c.trim()) }))
}

/**
 * 数値の読み方は品目取込・納品取込と同じ契約（csvParse.readNumericCell）を使う。
 * `parseFloat` の前方一致受理をやめたので、`12abc` `1,20` `-100` `abc100` は
 * 「取り込めない行」になり、行番号・列名・元の値・理由つきで呼び出し側へ渡る。
 */
export const RESULT_ERROR_INVALID_ROWS = 'invalid_rows'

/** 不正行を握り潰さずに例外へ載せる（画面が行番号・列名・元の値・理由を出せるようにする） */
function _invalidRowsError(errors) {
  const detail = errors.slice(0, 5).map(e => `${e.line}行目 ${e.reason}`).join(' / ')
  const rest   = errors.length > 5 ? ` ほか${errors.length - 5}件` : ''
  return Object.assign(
    new Error(`そのまま読めない値が${errors.length}件あります（${detail}${rest}）。ファイルを直してから取り込んでください`),
    { code: RESULT_ERROR_INVALID_ROWS, errors },
  )
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
  date:      ['日付', '棚卸日', '実施日', 'date'],
}

// 日付を 'YYYY-MM-DD' に正規化。解釈できなければ ''。
function _normDate(s) {
  let t = (s ?? '').trim()
  if (!t) return ''
  t = t.replace(/年|月/g, '-').replace(/日/g, '').replace(/[./]/g, '-').trim()
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ''
  const mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
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
  const records = _records(csvText)
  if (records.length < 2) throw new Error('データ行がありません')

  const header = records[0].cols
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
  const label = (i, fallback) => (header[i] ?? '').trim() || fallback
  const rows   = []
  const errors = []

  for (const { line, cols } of records.slice(1)) {
    const name = (cols[ci.name] ?? '').trim()
    if (!name || name === '【合計】' || name === '合計') continue

    // 数量が空欄の行は「未入力」であって不正ではない（棚卸で触っていない品目）
    if ((cols[ci.qty] ?? '').trim() === '') continue

    const qty = readNumericCell(cols[ci.qty], {
      line, column: ci.qty, columnLabel: label(ci.qty, '数量'),
    })
    if (qty.error) { errors.push({ ...qty.error, name }); continue }

    let price = null
    if (ci.price >= 0) {
      const p = readNumericCell(cols[ci.price], {
        line, column: ci.price, columnLabel: label(ci.price, '単価'),
      })
      if (p.error) { errors.push({ ...p.error, name }); continue }
      price = p.value ?? null
    }

    rows.push({
      name,
      qty:       qty.value,
      unit:      _cell(cols, ci.unit),
      code:      _cell(cols, ci.code),
      price,
      category:  _cell(cols, ci.category),
      lotSize:   _cell(cols, ci.lotSize),
      prevMonth: _cell(cols, ci.prevMonth),
    })
  }

  // 復元は確認画面を持たない一発操作なので、不正値があれば**取り込ませない**。
  // 一部だけ黙って復元すると、画面の「N件復元しました」が実データと合わなくなる。
  if (errors.length) throw _invalidRowsError(errors)
  if (rows.length === 0) throw new Error('復元できる数量データが見つかりませんでした')
  return rows
}

// 過去棚卸の一括インポート用。日付列を持つ棚卸結果CSVを日付ごとのスナップショットに束ねる。
// 戻り値: { snapshots: [{ date:'YYYY-MM-DD', items:[{ item, qty, unit, unitPrice, ... }] }], errors: [...] }
// 日付列が無い／有効な日付が1つも無い場合は throw（過去棚卸には日付が必須）。
// 数値として読めない数量・単価は捨てずに errors へ入れ、確認画面が行番号つきで出す。
export function parseResultSnapshots(csvText) {
  const records = _records(csvText)
  if (records.length < 2) throw new Error('データ行がありません')

  const header = records[0].cols
  const ci = {
    date:      _findCol(header, COLS.date),
    name:      _findCol(header, COLS.name),
    qty:       _findCol(header, COLS.qty),
    unit:      _findCol(header, COLS.unit),
    code:      _findCol(header, COLS.code),
    price:     _findCol(header, COLS.price),
    category:  _findCol(header, COLS.category),
    lotSize:   _findCol(header, COLS.lotSize),
    prevMonth: _findCol(header, COLS.prevMonth),
  }
  if (ci.date < 0) throw new Error('過去棚卸の取込には「日付」列が必要です')
  if (ci.name < 0 || ci.qty < 0) throw new Error('棚卸結果CSVの形式ではありません（「品目名」「数量」列が必要です）')

  const _cell = (cols, i) => i >= 0 ? (cols[i] ?? '').trim() : ''
  const label  = (i, fallback) => (header[i] ?? '').trim() || fallback
  const byDate = new Map()
  const errors = []

  for (const { line, cols } of records.slice(1)) {
    const name = (cols[ci.name] ?? '').trim()
    if (!name || name === '【合計】' || name === '合計') continue

    const dateRaw = (cols[ci.date] ?? '').trim()
    const date    = _normDate(cols[ci.date])
    if (!date) {
      // 日付が空の行は集計行などの可能性があるので黙って飛ばす。
      // 書いてあるのに読めない日付は、取り込む日を1日ぶん失うのでエラーにする。
      if (dateRaw !== '') {
        errors.push({
          line, column: ci.date, columnLabel: label(ci.date, '日付'), value: dateRaw, name,
          reason: `日付「${dateRaw}」を YYYY-MM-DD として読めません`,
        })
      }
      continue
    }

    if ((cols[ci.qty] ?? '').trim() === '') continue

    const qty = readNumericCell(cols[ci.qty], {
      line, column: ci.qty, columnLabel: label(ci.qty, '数量'),
    })
    if (qty.error) { errors.push({ ...qty.error, name, date }); continue }

    let price = null
    if (ci.price >= 0) {
      const p = readNumericCell(cols[ci.price], {
        line, column: ci.price, columnLabel: label(ci.price, '単価'),
      })
      if (p.error) { errors.push({ ...p.error, name, date }); continue }
      price = p.value ?? null
    }

    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push({
      item:      name,
      qty:       qty.value,
      unit:      _cell(cols, ci.unit),
      unitPrice: price,
      code:      _cell(cols, ci.code),
      category:  _cell(cols, ci.category) || null,
      lotSize:   _cell(cols, ci.lotSize),
      prevMonth: _cell(cols, ci.prevMonth),
    })
  }

  if (byDate.size === 0) {
    if (errors.length) throw _invalidRowsError(errors)
    throw new Error('取り込める棚卸データが見つかりませんでした（日付・数量を確認してください）')
  }

  // 過去棚卸は確認画面を持つので、不正行は捨てずに一緒に返して画面へ出す
  // （ユーザーが気づかないまま確定できないよう、画面側で確認を必須にする）。
  return {
    snapshots: [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => ({ date, items })),
    errors,
  }
}
