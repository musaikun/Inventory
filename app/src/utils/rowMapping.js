// 任意フォーマットの表を「取込パーサが読める中間CSV」へ組み直すための純関数。
//
// 過去の納品・過去の棚卸の取込は、ヘッダ名から列を特定する（`deliveryImportParser` /
// `resultCsvParser`）。仕入先ごとに列名が違うファイルはここで弾かれて行き止まりになるため、
// ユーザーが列を指定 → **正規のヘッダ名を持つCSVへ組み直してから**既存パーサへ渡す。
//
// 検証・日付正規化・上限・重複判定は既存パーサのままにする（取込の契約を二重化しない）。

import { toCSVRow } from './csvParse.js'
import { headerMatches } from './importText.js'

/**
 * 列名から対応する列を推測する。**見出し行があると宣言されたときだけ**使う。
 * 見出しが無いファイルで推測すると、1行目のデータを列名と誤読する。
 */
export function detectColumn(headerCols, hints) {
  if (!Array.isArray(headerCols) || !Array.isArray(hints)) return null
  for (let i = 0; i < headerCols.length; i++) {
    // 実運用の帳票は半角カナで書かれる（`商品ｺｰﾄﾞ`）。字形をそろえてから比べないと、
    // 読めているのに「その列は無い」ことになって手作業へ落ちる。
    if (headerMatches(headerCols[i], hints)) return i
  }
  return null
}

/**
 * 選んだ列だけを取り出して中間CSVを作る。
 *
 * @param {Array} records tokenizeCSV の rows（{ line, cols }）
 * @param {Object} mapping { fieldKey: columnIndex|null }
 * @param {Array}  fields  [{ key, header }] header = 既存パーサが認識する列名
 * @param {boolean} hasHeader 1行目を見出しとして捨てるか
 * @returns {string} ヘッダ1行 + データ行のCSV。データが無ければヘッダのみ。
 *
 * 値は加工しない（空白の trim までに留める）。数値・日付の解釈は既存パーサの仕事で、
 * ここで先に整形すると「画面で見た値」と「取り込まれた値」がずれる。
 */
export function buildMappedCSV(records, mapping, fields, hasHeader) {
  const used = fields.filter(f => mapping[f.key] !== null && mapping[f.key] !== undefined)
  const lines = [toCSVRow(used.map(f => f.header))]
  const dataRows = hasHeader ? records.slice(1) : records

  for (const rec of dataRows) {
    const cols = rec?.cols ?? []
    // 全項目が空の行は出さない（元ファイルの空行・区切り行をデータ行に見せない）
    const cells = used.map(f => String(cols[mapping[f.key]] ?? '').trim())
    if (cells.every(c => c === '')) continue
    lines.push(toCSVRow(cells))
  }
  return lines.join('\n')
}

/** 過去の棚卸取込（resultCsvParser.parseResultSnapshots）が読む列 */
export const STOCKTAKE_FIELDS = [
  { key: 'date',      header: '日付',       label: '日付',       required: true,
    hints: ['日付', '棚卸日', '実施日', 'date'] },
  { key: 'name',      header: '品目名',     label: '品目名',     required: true,
    hints: ['品目名', '商品名', '品名', '名称', 'name', 'item'] },
  { key: 'qty',       header: '数量',       label: '数量',       required: true,
    hints: ['数量', '在庫数', '棚卸数', 'qty'] },
  { key: 'unit',      header: '単位',       label: '単位',       hints: ['単位', 'unit'] },
  { key: 'price',     header: '単価',       label: '単価',       hints: ['単価', '原価', 'price'] },
  { key: 'category',  header: 'カテゴリ',   label: 'カテゴリ',   hints: ['カテゴリ', '分類', 'ジャンル'] },
  { key: 'code',      header: '商品コード', label: '商品コード', hints: ['商品コード', 'コード', 'jan', 'ean'] },
  { key: 'lotSize',   header: '入数',       label: '入数',       hints: ['入数', '入り数', 'ロット'] },
  { key: 'prevMonth', header: '前月実績',   label: '前月実績',   hints: ['前月実績', '前月', '先月'] },
]

/** 過去の納品取込（deliveryImportParser.parseDeliveryImportCSV）が読む列 */
export const DELIVERY_FIELDS = [
  { key: 'date',     header: '日付',       label: '日付',       required: true,
    hints: ['日付', '納品日', '入荷日', '伝票日付', '取引日', 'date'] },
  { key: 'name',     header: '品目名',     label: '品目名',     required: true,
    hints: ['品目名', '商品名', '品名', '名称', 'item'] },
  { key: 'qty',      header: '数量',       label: '数量',       required: true,
    hints: ['数量', '入荷数', '納品数', 'qty'] },
  { key: 'type',     header: '種別',       label: '種別（入庫／出庫）', hints: ['種別', '区分', '入出庫', 'type'] },
  { key: 'supplier', header: '仕入先',     label: '仕入先',     hints: ['仕入先', '業者', '取引先', 'ベンダー'] },
  { key: 'category', header: 'カテゴリ',   label: 'カテゴリ',   hints: ['カテゴリ', '分類', 'ジャンル', '部門'] },
  { key: 'unit',     header: '単位',       label: '単位',       hints: ['単位', 'unit'] },
  { key: 'price',    header: '単価',       label: '単価',       hints: ['単価', '原価', '仕入単価', 'price'] },
  { key: 'code',     header: '商品コード', label: '商品コード', hints: ['商品コード', 'コード', '品番', 'jan'] },
  { key: 'lotSize',  header: '入数',       label: '入数',       hints: ['入数', '入り数', 'ロット', 'ケース入数'] },
]
