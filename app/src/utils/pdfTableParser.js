// テキスト層のあるPDFを、特定フォーマットに依存せず汎用的に解析する。
// pdfjs から得た「文字トークン（text, x, y）」の配列を受け取り、品目レコードを返す。
// アルゴリズム: 行クラスタリング → ヘッダ行検出（表記ゆれ辞書）→ 段組み分割 →
// 各データ行を列に割り当て。既存の決め打ちパーサー（rotate=90帳票）とは独立で、
// そちらが0件だったページのフォールバックとして使う。座標は読み方向（rotate=0）前提。

import { normText, isMetaName, isHeaderish } from './importText.js'

const ROW_TOL = 4      // 同一行とみなす y の許容差(px)
const LEFT_SLACK = 12  // 右寄せ数値を左隣の列に取り込むための境界オフセット
const SEC_SLACK = 6    // 段（セクション）境界の許容差

// ヘッダ語 → フィールドの判定。順序＝優先度（品目コードが品目名より先、入数が数量より先）
const HEADER_RULES = [
  { field: 'code',      re: /コード|ｺｰﾄﾞ|品番|code/i },
  { field: 'packQty',   re: /入数|入り数|入数量/i },
  { field: 'prevMonth', re: /前月|前回/i },
  { field: 'category',  re: /分類|カテゴリ|ジャンル|区分|category|genre/i },
  { field: 'unit',      re: /単位|unit/i },
  { field: 'price',     re: /単価|価格|金額|値段|price|unit\s*price|amount/i },
  { field: 'qty',       re: /数量|在庫|个数|個数|qty|quantity|stock/i },
  { field: 'name',      re: /品目名|商品名|品名|名称|品目|商品|item|name|product/i },
]

const _norm = normText

function _fieldOf(text) {
  const t = _norm(text)
  if (!t) return null
  for (const rule of HEADER_RULES) if (rule.re.test(t)) return rule.field
  return null
}

// y でクラスタリングして行を作る（上→下）
function _clusterRows(items) {
  const sorted = [...items]
    .map(i => ({ text: _norm(i.text), x: i.x, y: i.y }))
    .filter(i => i.text)
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const rows = []
  let cur = null
  for (const it of sorted) {
    if (!cur || Math.abs(cur.y - it.y) > ROW_TOL) { cur = { y: it.y, cells: [] }; rows.push(cur) }
    cur.cells.push({ text: it.text, x: it.x })
  }
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x)
  return rows
}

// 認識できるヘッダ語が最も多い行をヘッダとみなす（最低2、name必須）
function _findHeader(rows) {
  let best = null
  for (let i = 0; i < rows.length; i++) {
    const cells = []
    const seen = new Set()
    for (const c of rows[i].cells) {
      const field = _fieldOf(c.text)
      // 同一セル内で1フィールド。ただし段組みでは同じfieldが複数x位置に出るので許容
      if (field) cells.push({ field, x: c.x })
    }
    for (const c of cells) seen.add(c.field)
    if (seen.has('name') && seen.size >= 2) {
      if (!best || cells.length > best.cells.length) best = { rowIndex: i, cells }
    }
  }
  return best
}

// ヘッダセルを段（左右2列レイアウト等）に分割
function _splitSections(headerCells) {
  const sorted = [...headerCells].sort((a, b) => a.x - b.x)
  const anchorField = sorted[0].field
  const starts = sorted.filter(c => c.field === anchorField).map(c => c.x)
  const sections = []
  for (let i = 0; i < starts.length; i++) {
    const xMin = starts[i] - SEC_SLACK
    const xMax = i + 1 < starts.length ? starts[i + 1] - SEC_SLACK : Infinity
    const columns = sorted.filter(c => c.x >= xMin && c.x < xMax)
    if (columns.length >= 2) sections.push({ xMin, xMax, columns })
  }
  return sections.length ? sections : [{ xMin: -Infinity, xMax: Infinity, columns: sorted }]
}

// 1行のセル群を、その段の列（フィールド）へ割り当ててレコード化
function _mapRow(cells, columns) {
  const cols = [...columns].sort((a, b) => a.x - b.x)
  const bounds = cols.map(c => c.x - LEFT_SLACK)   // 右寄せ数値を左列に取り込む境界
  const rec = {}
  for (const cell of cells) {
    let idx = 0
    for (let i = 0; i < bounds.length; i++) if (cell.x >= bounds[i]) idx = i
    const field = cols[idx].field
    rec[field] = rec[field] ? `${rec[field]} ${cell.text}` : cell.text
  }
  if (!rec.name) return null
  return {
    name:      rec.name,
    unit:      rec.unit ?? '',
    price:     rec.price ? rec.price.replace(/[^\d.]/g, '') : '',
    category:  rec.category ?? '',
    code:      rec.code ?? '',
    packQty:   rec.packQty ?? '',
    prevMonth: rec.prevMonth ?? '',
  }
}

/**
 * 手動マッピング/プロファイルで指定した列に沿って抽出する（汎用検出に頼らない）。
 * columns = [{ field, x }]（見本行でユーザーがタップした列）。
 * fromY = データ開始行の y（この y 以下＝表の下方向をデータとみなす）。省略時は全行。
 *
 * **同じフィールドを複数のxで指定できる**＝1ページに表が2枚以上並ぶ帳票（2段組み）。
 * 段を分けずに読むと、右段の値が左段の列へ吸い込まれて単価が `1200280` のように
 * 連結され、右段の品目はまるごと消える。自動解析 `parseGenericTable` は
 * `_splitSections` で段を分けていたのに、手動経路（PdfColumnMapper・保存済みレシピ）
 * だけが分けていなかった。「自動で読めなかったから手動へ」という経路なので、
 * 自動が失敗しがちな汚いPDFほどこの壊れ方に当たっていた。
 *
 * @returns {Array<{name,unit,price,category,code,packQty,prevMonth}>}
 */
export function extractRows(items, columns, { fromY = Infinity } = {}) {
  if (!Array.isArray(items) || !Array.isArray(columns) || columns.length < 2) return []
  if (!columns.some(c => c.field === 'name')) return []
  const rows = _clusterRows(items).filter(r => r.y <= fromY + ROW_TOL)
  const sections = _splitSections(columns)
  const products = []
  for (const sec of sections) {
    for (const row of rows) {
      // 段が1つのときは左端より外のセルも今までどおり左の列へ寄せる
      // （行番号や記号を落とすかどうかは、この修正で変える話ではない）
      const cells = sections.length === 1
        ? row.cells
        : row.cells.filter(c => c.x >= sec.xMin - 2 && c.x < sec.xMax)
      if (!cells.length) continue
      const rec = _mapRow(cells, sec.columns)
      if (rec && rec.name && !isMetaName(rec.name) && !isHeaderish(rec.name)) products.push(rec)
    }
  }
  return products
}

/**
 * トークンの座標を「読み方向」へそろえる。
 *
 * 実物の棚卸記入表は rotate=90 で刷られていて、そのままでは
 * **x が行の位置・y が列の位置**になる。列を x で束ねる仕組み（この file 全体と
 * PdfColumnMapper）は、回転した紙では2枚目の表の商品名を1枚目と同じ列と判定して
 * しまい、タップしても付かずに外れる。入口で1度そろえておく。
 *
 * 実測（PRONTO 棚卸記入表・rotate=90・1ページ目）:
 *   x = 行の位置で、**下へ行くほど増える**（見出し129 → 1行目143 → 2行目157 …）
 *   y = 列の位置で、**右へ行くほど増える**（行番号46 → コード74 → 商品名107 → 単位246 …）
 * 読み方向は「y が右・x が下」なので、列軸は +y、行軸は -x（大きいほど上）になる。
 * 270度はその鏡像（90度ぶんは実測、270度は対称から導いた）。
 */
export function toReadingCoords(x, y, rotate) {
  const r = ((rotate ?? 0) % 360 + 360) % 360
  if (r === 90)  return { x: y, y: -x }
  if (r === 270) return { x: -y, y: x }
  return { x, y }
}

/**
 * この紙に同じ形の表が何枚並んでいるか（段組みの数）を、見出しから見積もる。
 * 手動で列を指定する画面が「右の表の列も指定してください」と言えるようにするためのもの。
 * 見出しが見つからなければ 0（分からない）を返す ── 推測で断定しない。
 */
const NAME_HEADER_RE = /^(品目名|商品名|品名|名称)$/
export function detectSectionCount(items) {
  if (!Array.isArray(items) || items.length < 6) return 0
  const header = _findHeader(_clusterRows(items))
  if (header) return _splitSections(header.cells).length
  // 回転している帳票（rotate=90）では、行クラスタリングも見出し検出も効かない。
  // 実物の棚卸記入表がこれで、そこでこそ段の数を知りたい。
  // 「商品名」のような品目名の見出しが1ページに何度出るかを、そのまま段の数とみなす。
  return items.filter(i => NAME_HEADER_RE.test(normText(i.text))).length
}

/**
 * 汎用テーブル解析。items = [{ text, x, y }]（rotate=0の読み方向座標）。
 * @returns {Array<{name,unit,price,category,code,packQty,prevMonth}>}
 */
export function parseGenericTable(items) {
  if (!Array.isArray(items) || items.length < 6) return []
  const rows = _clusterRows(items)
  const header = _findHeader(rows)
  if (!header) return []
  const sections = _splitSections(header.cells)
  const dataRows = rows.slice(header.rowIndex + 1)
  const products = []
  for (const sec of sections) {
    for (const row of dataRows) {
      const cells = row.cells.filter(c => c.x >= sec.xMin - 2 && c.x < sec.xMax)
      if (!cells.length) continue
      const rec = _mapRow(cells, sec.columns)
      if (rec && rec.name && !isMetaName(rec.name) && !isHeaderish(rec.name)) products.push(rec)
    }
  }
  return products
}
