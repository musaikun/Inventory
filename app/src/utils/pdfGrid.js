/**
 * PDFのトークンを「行×列の表」に組み直す。
 *
 * PDFの列指定だけが、他の取込と**違う操作**だった。CSV・Excel は
 * 「見出しの行はどれ？ → どの列が品目名？」と表の上で答えるのに、PDFだけは
 * 紙の上の文字をタップして列を作る画面（`PdfColumnMapper`）で、覚えたことが
 * 経路をまたいで効かない。ここで紙を先に表へ均しておけば、そのあとは
 * `ImportMapper` ── CSV・Excel と同じ画面 ── にそのまま流せる。
 *
 * 段組み（同じ形の表が1枚の紙に横に並ぶ帳票）は、**この変換の中で解く**。
 * 右段を左段の下へ縦に積んでしまえば表は1枚になり、「1列＝1項目」という
 * `ImportMapper` の前提に触れずに済む。段の数は人に訊く ── 少なく答えると
 * 右半分がまるごと落ちるが、読んだ後では「無いこと」に気づけないため。
 *
 * 列の決め方は2段構え。
 *
 *   ① 行ごとに、隣り合う文字を**セル**へまとめる（区間が触れていれば同じセル）。
 *      折り返した品目名（`豆乳` / `２００ｍｌ`）はここで1つになる。
 *   ② セルの数がそろっている行が多数なら、**何番目のセルか**で列にする。
 *
 * ②が肝で、x座標だけで列を作ると**見出しと数字がずれる**。帳票の見出しは左寄せ、
 * 数量・単価は右寄せで刷られるため、`単価` の見出しは価格の少し左、`数量` の見出しは
 * 価格に重なる位置に来る。x で束ねると「単価の列は全行空、価格は数量の列」という
 * 表ができあがり、列指定の画面では見出しの名前と中身が食い違ったまま人が選ぶことになる。
 * セルの数がそろわない行（帳票の表題・欠けのある行）だけ、位置から当てる。
 */
import { toCSVRow } from './csvParse.js'
import { toReadingCoords } from './pdfTableParser.js'
import { normText } from './importText.js'

const COL_GAP     = 3     // これ未満しか空いていない隣どうしは同じセル
const SEC_SLACK   = 6     // 段の境界の許容差
const WIDE_RATIO  = 0.4   // 段の幅のこれ以上を占めるセル（表題・注記）は列決めに使わない
const DENSE_CELLS = 3     // 「表の行」とみなす最小セル数
const MODAL_MIN   = 0.4   // 同じセル数の行がこれ以上を占めたら、番号で列にする
                          // （折り返した品目名の行は文字数が1つ多いので、過半数は求めない）
const CHAR_W      = 6     // 幅の無いトークンの見積り（テストや古い呼び出し向け）
const CHAR_H      = 10    // 高さの無いトークンの見積り
const ROW_FACTOR  = 0.5   // 行の高さ＝文字の高さ×これ。人が画面で上げ下げできる（レシピに残る）
const ROW_MIN     = 2

const NAME_HEADER_RE = /^(品目名|商品名|品名|名称)$/

/** ページのトークンを読み方向へそろえる（rotate=90 の帳票をここで吸収する） */
function readingTokens(page) {
  const rotate = page?.rotate ?? 0
  const out = []
  for (const t of page?.tokens ?? []) {
    const text = String(t?.text ?? '').trim()
    if (!text) continue
    const c = toReadingCoords(t.x, t.y, rotate)
    const w = Number.isFinite(t.w) && t.w > 0 ? t.w : text.length * CHAR_W
    const h = Number.isFinite(t.h) && t.h > 0 ? t.h : CHAR_H
    out.push({ text, x: c.x, y: c.y, w, h })
  }
  return out
}

/**
 * 段の境界と原点。
 *
 * 原点を「品目名の見出し」にそろえるのがこの関数の肝で、段ごとの相対xが一致するから
 * 右段の値が左段と同じ列に収まる。段の左端（行番号の列）は見出しより左にあるので、
 * その分（lead）だけ境界を左へ広げておく。
 */
function sectionsOf(tokens, sections) {
  if (sections <= 1 || !tokens.length) return [{ xMin: -Infinity, xMax: Infinity, origin: 0 }]

  const minX = Math.min(...tokens.map(t => t.x))
  const anchors = []
  for (const t of tokens.filter(t => NAME_HEADER_RE.test(normText(t.text))).sort((a, b) => a.x - b.x)) {
    if (!anchors.length || t.x - anchors[anchors.length - 1] > COL_GAP * 4) anchors.push(t.x)
  }

  let starts, lead
  if (anchors.length === sections) {
    starts = anchors
    lead   = anchors[0] - minX          // 表の左端から品目名の列までの距離
  } else {
    // 見出しが見つからない紙は、トークンのx範囲を段の数で等分する
    const maxX = Math.max(...tokens.map(t => t.x + t.w))
    const w    = (maxX - minX) / sections
    starts = Array.from({ length: sections }, (_, i) => minX + w * i)
    lead   = 0
  }

  const cuts = starts.map((s, i) => (i === 0 ? -Infinity : gutterBefore(tokens, s, s - starts[i - 1], lead)))
  return starts.map((s, i) => ({
    xMin:   cuts[i],
    xMax:   i + 1 < cuts.length ? cuts[i + 1] : Infinity,
    origin: s,
  }))
}

/**
 * 段の切れ目（表と表のあいだの空白）を、見出しの少し左から探す。
 *
 * 「品目名の見出しから左へ一定距離」で切ると、段の左端の列（行番号など）の位置が
 * 段ごとに少しずれている紙で、**右の表の行番号が左の表の行に混ざる**。
 * 紙の上で本当に何も刷られていない帯を切れ目にすれば、その取り違えが起きない。
 */
function gutterBefore(tokens, anchor, pitch, lead) {
  const winL = anchor - pitch * 0.45
  const inWin = tokens.filter(t => t.x + t.w > winL && t.x < anchor).sort((a, b) => a.x - b.x)
  if (!inWin.length) return anchor - lead - SEC_SLACK
  let cur = inWin[0].x + inWin[0].w, bestGap = 0, bestAt = null
  for (const t of inWin.slice(1)) {
    if (t.x > cur) {
      const gap = t.x - cur
      if (gap > bestGap) { bestGap = gap; bestAt = (cur + t.x) / 2 }
    }
    cur = Math.max(cur, t.x + t.w)
  }
  if (bestAt !== null && bestGap >= SEC_SLACK) return bestAt
  return anchor - lead - SEC_SLACK    // 空白が見つからない紙は、見出しからの距離で切る
}

/**
 * y でクラスタリングして行を作る（上→下・行内は左→右）。
 *
 * ここで「近い文字どうしをセルにまとめる」ことはしない。隙間の大きさで決めてしまうと、
 * 列の詰まった帳票では**隣の列の見出しまで1つのセルになる**（`商品ｺｰﾄﾞ 商品名`）。
 * 折り返した品目名を1つに戻すのは、列が決まったあと（同じ列に入った文字を合流させる）。
 */
function rowsOf(tokens, rowTol) {
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  let cur = null
  for (const t of sorted) {
    if (!cur || Math.abs(cur.y - t.y) > rowTol) { cur = { y: t.y, cells: [] }; lines.push(cur) }
    cur.cells.push({ text: t.text, left: t.x, right: t.x + t.w })
  }
  for (const l of lines) l.cells.sort((a, b) => a.left - b.left)
  return lines.map(l => l.cells)
}

/**
 * 行としてまとめる y の許容差を、**その紙の文字の高さ**から決める。
 *
 * 固定値（4px）だと紙ごとに外れる。行間の広い帳票では1行が2行に割れて品目名と
 * 数量が別の行になり、詰まった紙では2行がくっつく。どちらも「表がめちゃくちゃ」に
 * 見える正体で、直すつまみはこの1つ。人が画面で上げ下げした値（factor）はレシピに残す。
 */
function rowTolOf(tokens, factor) {
  const hs = tokens.map(t => t.h).filter(h => h > 0).sort((a, b) => a - b)
  const median = hs.length ? hs[Math.floor(hs.length / 2)] : CHAR_H
  return Math.max(ROW_MIN, median * (factor > 0 ? factor : ROW_FACTOR))
}

function _dist(col, cell) {
  const mid = (cell.left + cell.right) / 2
  if (mid >= col.left - COL_GAP && mid <= col.right + COL_GAP) return 0
  return mid < col.left ? col.left - mid : mid - col.right
}

/**
 * セル数が多数派とそろわない行を、**左から右の順番を崩さずに**列へ入れる。
 *
 * 単に「いちばん近い列」へ入れると、隣り合う見出しが同じ列に落ちて連結される
 * （`単価 数量` が1マスに入り、その左の列は全行空になる）。見出しの行はまさに
 * これが起きやすい ── 見出しは左寄せ、数字は右寄せで刷られるため。
 * 順番を守り、右に残るセルのぶんだけ列を空けておけば、その潰れ方をしない。
 */
function placeInOrder(cols, cells) {
  if (cells.length > cols.length) return cells.map(c => {
    let best = 0, bestD = Infinity
    cols.forEach((col, i) => { const d = _dist(col, c); if (d < bestD) { bestD = d; best = i } })
    return best
  })
  const out = []
  let lo = 0
  cells.forEach((c, k) => {
    const hi = cols.length - (cells.length - k)   // 右に残すセルのぶんは空けておく
    let best = lo, bestD = Infinity
    for (let i = lo; i <= Math.max(lo, hi); i++) {
      const d = _dist(cols[i], c)
      if (d < bestD) { bestD = d; best = i }
    }
    out.push(best)
    lo = best + 1
  })
  return out
}

/** セル数がそろっている行が多数派なら、その並びを列にする（見出しと数字がずれない） */
function ordinalColumns(dense) {
  const count = new Map()
  for (const cells of dense) count.set(cells.length, (count.get(cells.length) ?? 0) + 1)
  let modal = 0, modalN = 0
  for (const [len, n] of count) if (n > modalN || (n === modalN && len > modal)) { modal = len; modalN = n }
  if (!modal || modalN < Math.max(2, dense.length * MODAL_MIN)) return null

  const cols = Array.from({ length: modal }, () => ({ left: Infinity, right: -Infinity }))
  for (const cells of dense) {
    if (cells.length !== modal) continue
    cells.forEach((c, i) => {
      cols[i].left  = Math.min(cols[i].left, c.left)
      cols[i].right = Math.max(cols[i].right, c.right)
    })
  }
  return { cols, modal }
}

/** 位置だけで列を作る（セル数がそろわない紙の受け皿）。区間が触れていれば同じ列 */
function geometricColumns(cells, secWidth) {
  const usable = secWidth > 0 ? cells.filter(c => c.right - c.left <= secWidth * WIDE_RATIO) : cells
  const cols = []
  for (const c of [...usable].sort((a, b) => a.left - b.left)) {
    const last = cols[cols.length - 1]
    if (last && c.left <= last.right + COL_GAP) last.right = Math.max(last.right, c.right)
    else cols.push({ left: c.left, right: c.right })
  }
  return cols
}

/**
 * 自動で決めた列を、**人が直せる形**＝境界線の並びに落とす。
 *
 * 「この列とこの列を合わせる」「ここで分ける」は、境界を1本消す・足すだけで表せる。
 * 値そのものを書き換える直し方と違って、**同じ紙なら翌月も同じように効く**ので
 * レシピに残せる（`edges`）。列の区間が重なっていても、中間で切れば右寄せの数字と
 * 左寄せの見出しは同じ側に落ちる。
 */
export function edgesOfColumns(cols) {
  const out = []
  for (let i = 0; i + 1 < cols.length; i++) out.push((cols[i].right + cols[i + 1].left) / 2)
  return out
}

/** 境界の並びからセルの入る列番号を出す（境界方式。人が直したときはこちらを使う） */
function columnAtEdges(edges, cell) {
  const mid = (cell.left + cell.right) / 2
  let i = 0
  while (i < edges.length && mid >= edges[i]) i++
  return i
}

/**
 * PDFの全ページを1枚の表にする。
 *
 * @param {Array<{tokens: Array<{text,x,y,w}>, rotate: number}>} pages `parsePdfFile` が返すページ
 * @param {{sections?: number}} opts sections = 1枚の紙に並ぶ表の数（人が答えた値）
 * @returns {string[][]} 行の配列。ページ順 → 段順（左→右）に縦へ積む
 */
/**
 * ページのトークンを、段ごと・行ごとのセルに集める（列を決める前の段階）。
 * 表を組むときと、画面で「ここで分ける」と言われたときの両方から呼ぶ。
 */
function collectCells(pages, sections, rowFactor) {
  const all = []
  let secWidth = 0
  const n = Math.max(1, Math.round(sections) || 1)

  for (const page of pages ?? []) {
    const tokens = readingTokens(page)
    if (!tokens.length) continue
    const rowTol = rowTolOf(tokens, rowFactor)
    for (const band of sectionsOf(tokens, n)) {
      const inBand = []
      for (const t of tokens) {
        if (t.x < band.xMin || t.x >= band.xMax) continue
        inBand.push({ text: t.text, x: t.x - band.origin, y: t.y, w: t.w, h: t.h })
      }
      if (!inBand.length) continue
      const left  = Math.min(...inBand.map(c => c.x))
      const right = Math.max(...inBand.map(c => c.x + c.w))
      secWidth = Math.max(secWidth, right - left)
      all.push(...rowsOf(inBand, rowTol))
    }
  }
  return { all, secWidth, n }
}

/**
 * 「この列をここで分ける」と言われたときの切りどころ。
 *
 * その列に入っている文字の区間をつないで、**いちばん広く空いているところ**を返す。
 * 位置を人に指定させるより、紙の上の空白に合わせたほうが速くて外れない。
 * 分けられる空白が無ければ null（画面はボタンを出さない）。
 */
export function suggestEdge(pages, { sections = 1, rowFactor = ROW_FACTOR, edges = [] } = {}, colIndex = 0) {
  const { all } = collectCells(pages, sections, rowFactor)
  const inCol = []
  for (const cells of all) {
    for (const c of cells) if (columnAtEdges(edges, c) === colIndex) inCol.push(c)
  }
  if (inCol.length < 2) return null
  inCol.sort((a, b) => a.left - b.left)
  let cur = inCol[0].right, bestGap = 0, bestAt = null
  for (const c of inCol.slice(1)) {
    if (c.left > cur) {
      const gap = c.left - cur
      if (gap > bestGap) { bestGap = gap; bestAt = (cur + c.left) / 2 }
    }
    cur = Math.max(cur, c.right)
  }
  return bestGap >= COL_GAP ? bestAt : null
}

export function pdfPagesToRows(pages, opts) {
  return pdfPagesToTable(pages, opts).rows
}

/**
 * PDFの全ページを1枚の表にする。**組み上がった表と、その作り方**を返す。
 *
 * 作り方（`sections` / `rowFactor` / `edges`）はすべて数値なので、画面で直した結果を
 * そのままレシピに保存できる。専用の解析を持たない見知らぬ帳票では、一度で正しく
 * 組み上がる前提を置かない ── 人が画面で直し、その直し方が次回に効くことを前提にする。
 *
 * @param {Array<{tokens: Array<{text,x,y,w,h}>, rotate: number}>} pages `parsePdfFile` が返すページ
 * @param {{sections?: number, rowFactor?: number, edges?: number[]}} opts
 *   sections  = 1枚の紙に並ぶ表の数（人が答えた値）
 *   rowFactor = 行としてまとめる高さ（文字の高さに対する倍率）
 *   edges     = 列の境界（段の原点からの相対x）。人が直したときだけ入る
 * @returns {{rows: string[][], edges: number[], rowFactor: number, sections: number}}
 */
export function pdfPagesToTable(pages, { sections = 1, rowFactor = ROW_FACTOR, edges = null } = {}) {
  const { all, secWidth, n } = collectCells(pages, sections, rowFactor)
  const empty = { rows: [], edges: edges ?? [], rowFactor, sections: n }
  if (!all.length) return empty

  // 人が境界を直していればそれが正。直していなければ自動で列を決める
  if (Array.isArray(edges) && edges.length) {
    const width = edges.length + 1
    const rows = []
    for (const cells of all) {
      const row = new Array(width).fill('')
      for (const c of cells) {
        const i = columnAtEdges(edges, c)
        row[i] = row[i] ? `${row[i]} ${c.text}` : c.text
      }
      if (row.some(v => v !== '')) rows.push(row)
    }
    // 空の列も残す ── 人が引いた線を黙って消すと、直した手応えと画面が食い違う
    return { rows, edges: [...edges], rowFactor, sections: n }
  }

  const dense = all.filter(cells => cells.length >= DENSE_CELLS)
  const byOrdinal = ordinalColumns(dense)
  const cols = byOrdinal ? byOrdinal.cols : geometricColumns(all.flat(), secWidth)
  if (!cols.length) return empty

  const out = []
  for (const cells of all) {
    const row = new Array(cols.length).fill('')
    // 多数派と同じセル数の行は並び順そのままに入れる。それ以外は位置から当てる
    // （欠けのある行を番号で入れると、そこから右がまるごと1つずれる）。
    const at = byOrdinal && cells.length === byOrdinal.modal
      ? cells.map((_, i) => i)
      : placeInOrder(cols, cells)
    cells.forEach((c, i) => {
      row[at[i]] = row[at[i]] ? `${row[at[i]]} ${c.text}` : c.text
    })
    if (row.some(v => v !== '')) out.push(row)
  }

  // 空の列を落とし、残った列から境界を作る（この境界が画面での直しの出発点になる）
  const keep = []
  for (let i = 0; i < cols.length; i++) if (out.some(r => r[i] !== '')) keep.push(i)
  const rows = keep.length === cols.length ? out : out.map(r => keep.map(i => r[i]))
  return { rows, edges: edgesOfColumns(keep.map(i => cols[i])), rowFactor, sections: n }
}

/** 組み直した表をCSVテキストにする。以降は CSV・Excel とまったく同じ経路を通る。 */
export function rowsToCsv(rows) {
  return (rows ?? []).map(r => toCSVRow(r)).join('\r\n')
}

export function pdfPagesToCsv(pages, opts) {
  return rowsToCsv(pdfPagesToRows(pages, opts))
}
