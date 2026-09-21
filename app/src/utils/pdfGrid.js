/**
 * PDFのトークンを「行×列の表」に組み直す。
 *
 * PDFの列指定だけが、他の取込と**違う操作**だった。CSV・Excel は
 * 「見出しの行はどれ？ → どの列が品目名？」と表の上で答えるのに、PDFだけは
 * 紙の上の文字をタップして列を作る別の画面で、覚えたことが経路をまたいで効かない。
 * ここで紙を先に表へ均しておけば、そのあとは `ImportMapper` ── CSV・Excel と
 * 同じ画面 ── にそのまま流せる。紙の上で直接指定する画面は、この道に一本化して廃止した。
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
const NUMERIC_RE = /^[-+]?[\d,]+(\.\d+)?$/
const isNumberish = (v) => NUMERIC_RE.test(String(v ?? '').trim()) && /\d/.test(String(v))
/** 行の同一性を見るための連結記号（本文に出ない文字） */
const ROW_KEY = String.fromCharCode(1)

/**
 * 字間をベタ空けで組んだ文字列を戻す。
 *
 * 帳票の見出しや品目名は「カ ラ ー テ レ ビ」「東 京 都 港 区」のように、
 * **1文字ずつ離して**組まれていることがある（組版の字送りで、文字と文字のあいだに
 * 空白が入っているわけではない）。そのまま扱うと、品目名が「電 気 掃 除 機」になって
 * 辞書にも品目リストにも一致しない。
 *
 * 落とすのは**すべての区切りが1文字ずつのとき**だけ。「2003 年 12 月 21 日」のように
 * 2文字以上の塊があるものは触らない ── そこで詰めると、本当に離れている語
 * （`商品コード 商品名`）まで1語にしてしまう。
 */
function unspace(text) {
  if (!text.includes(' ')) return text
  const parts = text.split(' ').filter(p => p !== '')
  if (parts.length < 2 || parts.some(p => [...p].length !== 1)) return text
  return parts.join('')
}

/**
 * ページのトークンを読み方向へそろえる（rotate=90 の帳票をここで吸収する）。
 *
 * ついでに**同じ位置に重なっている同じ文字**を1つにする。太字を「2回刷る」で作っている
 * 帳票があり（`売 売 上 上 伝 伝 票 票`）、そのままでは品目名や見出しが倍になる。
 */
function readingTokens(page) {
  const rotate = page?.rotate ?? 0
  const out = []
  const seen = new Set()
  for (const t of page?.tokens ?? []) {
    const text = unspace(String(t?.text ?? '').trim())
    if (!text) continue
    const c = toReadingCoords(t.x, t.y, rotate)
    const key = `${text}@${Math.round(c.x)},${Math.round(c.y)}`
    if (seen.has(key)) continue
    seen.add(key)
    const w = Number.isFinite(t.w) && t.w > 0 ? t.w : text.length * CHAR_W
    const h = Number.isFinite(t.h) && t.h > 0 ? t.h : CHAR_H
    out.push({ text, x: c.x, y: c.y, w, h })
  }
  return out
}

/**
 * 同じマスに入った文字をつなぐ。
 *
 * **1文字だけのトークンは空白を挟まずにつなぐ。** 字送りで1文字ずつ別のトークンに
 * なっている見出し（`商`｜`品`｜`名`）が、そのままでは `商 品 名` になり、
 * 「品目名の見出し」として認識できない ── 段組みの判定も見出し帯の切り離しも
 * ここに乗っているので、1か所の空白が取込ぜんぶに響く。
 * 2文字以上のトークン（折り返した品目名の続き `２００ｍｌ`）は空白で区切る。
 */
function joinCell(prev, text) {
  if (!prev) return text
  return [...text].length === 1 ? prev + text : `${prev} ${text}`
}

/**
 * 紙を「格子」に割る（横の段 × 縦の積み）。
 *
 * 段組み（同じ形の表が1枚の紙に横に並ぶ帳票）だけでなく、**縦に積まれた表**も
 * 帯として明示的に割る。縦は割らなくても行が上から下へ続くので表にはなるが、
 * 帯にすると2つ得がある ── 帯ごとに x の原点を持てるので**下の表が横にずれている紙でも
 * 列が揃い**、帯ごとに見出しの再掲を扱えるようになる。
 *
 * 人に訊くのは**枚数だけ**。それを横×縦のどう割るかは紙に訊く（`planLayout`）。
 * 縦か横かを人に選ばせると、3枚が縦並びの紙・4枚が2×2の紙で必ず迷う。
 */

/** 1枚の紙に並ぶ表の上限。実物で9枚（3×3）まで見ている */
export const GRID_MAX = 9

/**
 * 軸に沿った占有区間（重なりを潰して昇順）。切れ目を探す土台。
 *
 * 横は**文字の幅**で測る（字を割ってはいけない）。縦は**baseline だけ**で測る ──
 * 行は `rowsOf` が baseline を束ねて決めるので、字の高さぶんを占有とみなすと、
 * 行のすぐ上を切る正しい切れ目が「字の上を切っている」ことになってしまう。
 */
function spansOf(tokens, axis) {
  const raw = tokens
    .map(t => (axis === 'x' ? { lo: t.x, hi: t.x + t.w } : { lo: t.y, hi: t.y }))
    .sort((a, b) => a.lo - b.lo)
  const out = []
  for (const s of raw) {
    const last = out[out.length - 1]
    if (last && s.lo <= last.hi) last.hi = Math.max(last.hi, s.hi)
    else out.push({ ...s })
  }
  return out
}

/**
 * `at` の近くの空白へ切れ目を寄せる。
 *
 * 等分した位置でそのまま切ると文字を貫く。紙の上で本当に何も刷られていない帯へ
 * 寄せれば、右（下）の表の行が左（上）の表に混ざらない。横も縦も同じ理屈なので1つで済ます。
 */
function snapToGap(spans, at, reach) {
  let bestAt = null, bestGap = 0
  for (let i = 0; i + 1 < spans.length; i++) {
    const gap = spans[i + 1].lo - spans[i].hi
    if (gap < SEC_SLACK) continue
    const mid = (spans[i].hi + spans[i + 1].lo) / 2
    if (Math.abs(mid - at) > reach) continue
    if (gap > bestGap) { bestGap = gap; bestAt = mid }
  }
  return bestAt ?? at
}

/** 軸を n 等分して、それぞれの切れ目を空白へ寄せる（昇順の n-1 本） */
function axisCuts(tokens, axis, n) {
  if (n <= 1) return []
  const spans = spansOf(tokens, axis)
  if (spans.length < 2) return []
  const min = spans[0].lo, max = spans[spans.length - 1].hi
  const pitch = (max - min) / n
  const cuts = []
  for (let i = 1; i < n; i++) cuts.push(snapToGap(spans, min + pitch * i, pitch * 0.45))
  return cuts
}

/**
 * 品目名の見出し。格子の基準になる（これが並んでいる数＝枚数）。
 *
 * **1文字ずつ離れて組まれた見出しも拾う。** 帳票の見出しは字送りで
 * `商`｜`品`｜`名` と別のトークンになっていることがあり、1トークンずつ見ていると
 * 「品目名の見出しが無い紙」に見える。そうなると段組みも見出し帯も判定できず、
 * 宛名や住所まで表の行として混ざる（実物の納品書がこれだった）。
 *
 * 字送りの隙間は一定ではない（同じ行で 15pt と 38pt が混ざる）ので、隙間の幅では
 * 決められない。**同じ行の並びをつないで見出しの語になるか**で見る。
 * 位置は先頭の文字の x ── そこが品目名の列の左端。
 */
function anchorTokens(tokens) {
  const hit = (t) => NAME_HEADER_RE.test(normText(t.text))
  const out = tokens.filter(hit)

  // 行ごとに、隣り合う1文字のトークンをつないで見出しになるか試す。
  // 行にまとめる幅は紙ぜんぶの文字の高さから取る ── トークンごとの高さで割ると、
  // 大きな表題（h=24）と表の見出し（h=14）が同じ行に落ちて並び順が混ざる
  const singles = tokens.filter(t => [...t.text].length === 1)
  const tol = rowTolOf(tokens, ROW_FACTOR)
  const lines = []
  let cur = null
  for (const t of [...singles].sort((a, b) => b.y - a.y)) {
    if (!cur || Math.abs(cur.y - t.y) > tol) { cur = { y: t.y, items: [] }; lines.push(cur) }
    cur.items.push(t)
  }
  for (const { items: line } of lines) {
    line.sort((a, b) => a.x - b.x)
    for (let i = 0; i < line.length; i++) {
      let joined = ''
      for (let n = 0; n < 4 && i + n < line.length; n++) {
        joined += line[i + n].text
        if (n === 0) continue
        if (NAME_HEADER_RE.test(normText(joined))) {
          const first = line[i], last = line[i + n]
          out.push({ text: joined, x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h })
          i += n
          n = 4
        }
      }
    }
  }
  return out
}

/** 近い値をまとめて昇順に返す（同じ位置の見出しを1つに数える） */
function distinct(values, tol) {
  const out = []
  for (const v of [...values].sort((a, b) => a - b)) {
    if (!out.length || v - out[out.length - 1] > tol) out.push(v)
  }
  return out
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
 * 縦の切れ目を、見出しのすぐ上の空白から探す（`gutterBefore` の縦版）。
 *
 * 下の表の見出しより上は上の表なので、見出しの行と、その上の行のあいだで切る。
 * y は上へ向かって増える（`toReadingCoords` で読み方向へそろえた座標）。
 */
function gutterAbove(tokens, anchor, pitch) {
  const winT = anchor + pitch * 0.45
  const inWin = tokens.filter(t => t.y + t.h > anchor && t.y < winT).sort((a, b) => a.y - b.y)
  let cur = anchor, bestGap = 0, bestAt = null
  for (const t of inWin) {
    if (t.y > cur) {
      const gap = t.y - cur
      if (gap > bestGap) { bestGap = gap; bestAt = (cur + t.y) / 2 }
    }
    cur = Math.max(cur, t.y + t.h)
  }
  if (bestAt !== null && bestGap >= SEC_SLACK) return bestAt
  return anchor + SEC_SLACK
}

/**
 * 横 `cols` × 縦 `rows` に割るときの切れ目。
 *
 * 見出しの数が枚数と合っていればその手前の空白で切り（いちばん外れない）、
 * 合わなければ等分から空白へ寄せる。**採点も実際の割りも同じここを通す**ので、
 * 「良いと採点した割り方」と「実際に割った結果」が食い違わない。
 */
function cutsOf(tokens, cols, rows) {
  const anchors = anchorTokens(tokens)
  const ax = distinct(anchors.map(t => t.x), COL_GAP * 4)
  const ay = distinct(anchors.map(t => t.y), CHAR_H)

  let xCuts
  if (cols > 1 && ax.length === cols) {
    const minX = Math.min(...tokens.map(t => t.x))
    const lead = ax[0] - minX          // 表の左端から品目名の列までの距離
    xCuts = ax.slice(1).map((s, i) => gutterBefore(tokens, s, s - ax[i], lead))
  } else {
    xCuts = axisCuts(tokens, 'x', cols)
  }

  let yCuts
  if (rows > 1 && ay.length === rows) {
    // ay は昇順（下→上）。切れ目は、下の表の見出しのすぐ上
    yCuts = ay.slice(0, -1).map((s, i) => gutterAbove(tokens, s, ay[i + 1] - s))
  } else {
    yCuts = axisCuts(tokens, 'y', rows)
  }
  return { xCuts, yCuts, anchors }
}

/** 切れ目の並びを区間の並びにする（昇順・両端は無限） */
function rangesFromCuts(cuts) {
  const out = []
  let lo = -Infinity
  for (const c of cuts) { out.push({ lo, hi: c }); lo = c }
  out.push({ lo, hi: Infinity })
  return out
}

/**
 * 帯の並びと、帯ごとの x の原点。
 *
 * 並びは **左の段を下まで使ってから次の段へ**（新聞の段組みと同じ）。
 * 行の順番がそのまま品目の並び順になるので、ここを変えると棚卸カードの並びが崩れる。
 *
 * 原点は「1つ目の帯の取り方は今までと同じ、残りの帯は自分の見出しが1つ目と同じ相対位置に
 * 来るようにずらす」。こうすると保存済みレシピの `edges` の座標系が変わらないまま、
 * 下の表が横にずれている紙でも列が揃う。
 */
function bandsOf(tokens, cols, rows) {
  if (cols <= 1 && rows <= 1) {
    return [{ xMin: -Infinity, xMax: Infinity, yMin: -Infinity, yMax: Infinity, origin: 0 }]
  }
  const { xCuts, yCuts, anchors } = cutsOf(tokens, cols, rows)
  const xs = rangesFromCuts(xCuts)
  const ys = rangesFromCuts(yCuts).reverse()      // 上から下へ
  const minX = tokens.length ? Math.min(...tokens.map(t => t.x)) : 0

  const out = []
  for (const xr of xs) {
    const colAnchors = anchors.filter(t => t.x >= xr.lo && t.x < xr.hi)
    const anchorIn = (yr) => {
      const own = colAnchors.filter(t => t.y >= yr.lo && t.y < yr.hi)
      return own.length ? Math.min(...own.map(t => t.x)) : null
    }
    // 段の基準は、その段のいちばん上の帯の見出し
    let ref = null
    for (const yr of ys) { ref = anchorIn(yr); if (ref !== null) break }
    const colOrigin = cols > 1
      ? (ref ?? (Number.isFinite(xr.lo) ? xr.lo : minX))
      : 0
    for (const yr of ys) {
      const own = anchorIn(yr)
      out.push({
        xMin: xr.lo, xMax: xr.hi, yMin: yr.lo, yMax: yr.hi,
        origin: colOrigin + (own !== null && ref !== null ? own - ref : 0),
      })
    }
  }
  return out
}

/**
 * 切れ目が乗っている空白の広さ。**広い空白に乗っているほど、そこが表の切れ目**。
 *
 * 「いちばん近い文字までの距離」では測れない。正しい切れ目でも、見出しのすぐ手前に
 * 寄せてあれば近い文字はすぐ隣にある。乗っている空白の帯そのものの広さで見る。
 *
 * 字の上を切っているとき、帯が空になる位置（内容の外）のときは 0。
 */
function cutGap(spans, cut) {
  if (!spans.length) return 0
  if (cut <= spans[0].lo || cut >= spans[spans.length - 1].hi) return 0
  let prev = spans[0].hi
  for (const sp of spans.slice(1)) {
    if (cut < sp.lo) return cut > prev ? sp.lo - prev : 0
    prev = sp.hi
  }
  return 0
}

/**
 * 割り方を見るためのページのトークン。
 *
 * **品目名の見出しがある最初のページ**を使う。1ページ目が送付状や表紙で、表は
 * 2ページ目から始まる帳票が実在する（FAX送付状＋売上伝票）。1ページ目だけを見ると
 * 「見出しの無い紙」と判断して、段組みも見出し帯も分からなくなる。
 * どのページにも見出しが無ければ、最初の文字のあるページ。
 */
function firstPageTokens(pages) {
  let fallback = null
  for (const p of pages ?? []) {
    const tokens = readingTokens(p)
    if (!tokens.length) continue
    if (anchorTokens(tokens).length) return tokens
    if (!fallback) fallback = tokens
  }
  return fallback ?? []
}

/**
 * 「N枚」を横×縦にどう割るのが自然か、**紙に訊く**。
 *
 * N の約数の組み合わせ（4枚なら 4×1 / 2×2 / 1×4）を全部試し、切れ目が
 * **文字を貫かない**・**空白に余裕がある**ものを上にする。人が答えるのは枚数だけで、
 * 縦か横かは紙が決める ── 縦横を人に選ばせると、3枚が縦並びの紙で必ず迷う。
 *
 * 自動が外したときは画面で候補を切り替えられるように、順番をつけた一覧で返す。
 *
 * @returns {{best: {cols,rows}, candidates: Array<{cols,rows,pierced,clear}>}}
 */
export function planLayout(pages, count) {
  const n = Math.max(1, Math.min(GRID_MAX, Math.round(count) || 1))
  const raw = firstPageTokens(pages)
  // 見出し帯は紙いっぱいに広がるので、入れたままだと切れ目の見え方を狂わせる
  const tokens = raw.length ? tableBodyTokens(raw, rowTolOf(raw, ROW_FACTOR)) : raw
  const anchors = anchorTokens(tokens)
  const ax = distinct(anchors.map(t => t.x), COL_GAP * 4).length
  const ay = distinct(anchors.map(t => t.y), CHAR_H).length
  const spansX = spansOf(tokens, 'x')
  const spansY = spansOf(tokens, 'y')

  const candidates = []
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols) continue
    const rows = n / cols
    const gaps = []
    if (tokens.length && (cols > 1 || rows > 1)) {
      const { xCuts, yCuts } = cutsOf(tokens, cols, rows)
      for (const c of xCuts) gaps.push(cutGap(spansX, c))
      for (const c of yCuts) gaps.push(cutGap(spansY, c))
    }
    candidates.push({
      cols, rows,
      // 品目名の見出しの並びと合っているか。これがいちばん強い手がかりで、
      // 空白の広さだけで決めると**列のあいだの空白を表の切れ目と見間違える**
      // （縦に積まれた紙が「横2枚」に化ける）。
      // 横を重く見るのは、**下に続く表は見出しを繰り返さないことがある**ため。
      // 「見出しが1つのyにしか無い」は縦1枚の証拠として弱いが、
      // 「見出しが2つのxに並んでいる」は横2枚の証拠として強い。
      fit:   (anchors.length ? (ax === cols ? 2 : 0) + (ay === rows ? 1 : 0) : 0),
      worst: gaps.length ? Math.min(...gaps) : Infinity,
      clear: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity,
    })
  }
  candidates.sort((a, b) => b.fit - a.fit || b.worst - a.worst || b.clear - a.clear)
  const top = candidates[0]
  return { best: { cols: top?.cols ?? 1, rows: top?.rows ?? 1 }, candidates }
}

/**
 * 紙から枚数と割り方を見当てる。**9枚を目で数えさせたら負け**なので、ここを当てにいく。
 *
 * 品目名の見出しが x にいくつ散っているかで横の数、y にいくつ散っているかで縦の数。
 * 見出しが無い紙は分からないので null（人が枚数を選ぶ）。
 *
 * @returns {{cols:number, rows:number, count:number}|null}
 */
export function detectLayout(pages) {
  const tokens = firstPageTokens(pages)
  if (!tokens.length) return null
  const anchors = anchorTokens(tokens)
  if (!anchors.length) return null
  const cols = distinct(anchors.map(t => t.x), COL_GAP * 4).length
  const rows = distinct(anchors.map(t => t.y), CHAR_H).length
  const count = cols * rows
  if (count < 1 || count > GRID_MAX) return null
  return { cols, rows, count }
}

/** 呼び出し側が持っている値（古いレシピは `sections` だけ）を格子に正す */
function normLayout({ sections, layout } = {}) {
  const cols = Math.round(layout?.cols ?? sections ?? 1) || 1
  const rows = Math.round(layout?.rows ?? 1) || 1
  return {
    cols: Math.max(1, Math.min(GRID_MAX, cols)),
    rows: Math.max(1, Math.min(GRID_MAX, rows)),
  }
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

/**
 * 「表の1行目」の y。ここより上が**見出し帯**。
 *
 * 品目名の見出しがあればそこ。無ければ、上から見てセルが揃っている最初の行。
 */
function topTableY(tokens, rowTol) {
  const anchors = anchorTokens(tokens)
  if (anchors.length) return Math.max(...anchors.map(t => t.y))
  let cur = null
  for (const t of [...tokens].sort((a, b) => b.y - a.y)) {
    if (!cur || Math.abs(cur.y - t.y) > rowTol) cur = { y: t.y, n: 0 }
    cur.n++
    if (cur.n >= DENSE_CELLS) return cur.y
  }
  return null
}

/**
 * 見出し帯の語（上から下・左から右）。
 *
 * 帳票には「○○店　○月　冷凍」のように、**そのページの品目ぜんぶに効く情報が
 * 1ヵ所だけ**書かれていることがある。品目の行には無いので、表にしただけでは
 * 落ちてしまう。ここを拾って列に変えれば、以降はCSVとまったく同じに扱える。
 */
function headTokensOf(tokens, rowTol) {
  const topY = topTableY(tokens, rowTol)
  if (topY === null) return []
  return tokens.filter(t => t.y > topY + rowTol).sort((a, b) => b.y - a.y || a.x - b.x)
}

/**
 * 表として読む範囲のトークン。**見出し帯は落とす。**
 *
 * 「○○店　4月　冷凍」は表の行ではないのに、座標だけで組むと1行として混ざる
 * （列の数も合わないので、そこだけ列がずれて見える）。見出し帯は `pageHeads` から
 * 別に取れるので、表からは外す。
 *
 * 落とすのは**品目名の見出しが見つかったときだけ**。それが無い紙で当てずっぽうに
 * 切ると、本物の行が消える（消えたことには誰も気づけない）。
 */
function tableBodyTokens(tokens, rowTol) {
  if (!anchorTokens(tokens).length) return tokens
  const topY = topTableY(tokens, rowTol)
  if (topY === null) return tokens
  return tokens.filter(t => t.y <= topY + rowTol)
}

/** ページごとの見出し帯の語。画面は1ページ目を出し、値はページごとに読む */
export function pageHeads(pages, { rowFactor = ROW_FACTOR } = {}) {
  const out = []
  for (const page of pages ?? []) {
    const tokens = readingTokens(page)
    out.push(tokens.length ? headTokensOf(tokens, rowTolOf(tokens, rowFactor)) : [])
  }
  return out
}

/** 覚えた位置からこれだけ離れていたら、別のものと見なす（翌月の紙で取り違えない） */
const HEAD_SNAP = 30

/**
 * 覚えた位置から、そのページの見出しの語を読む。
 *
 * **値は固定しない。** 「○月」は翌月変わるので、覚えるのは位置のほう。
 * ページごとに読むので、1ページ目=冷凍 / 2ページ目=乾物 のように**分類が混ざらない**
 * （ファイル単位の固定値にすると、ここで使えなくなる）。
 */
function headValuesOf(pages, heads, rowFactor) {
  const perPage = pageHeads(pages, { rowFactor })
  return perPage.map(tokens => (heads ?? []).map(h => {
    let best = null, bestD = Infinity
    for (const t of tokens) {
      const d = Math.hypot(t.x - h.x, t.y - h.y)
      if (d < bestD) { bestD = d; best = t }
    }
    return best && bestD <= HEAD_SNAP ? best.text : ''
  }))
}

function _dist(col, cell) {
  const mid = (cell.left + cell.right) / 2
  if (mid >= col.left - COL_GAP && mid <= col.right + COL_GAP) return 0
  return mid < col.left ? col.left - mid : mid - col.right
}

const median = (xs) => {
  if (!xs.length) return 0
  const a = [...xs].sort((p, q) => p - q)
  const i = a.length >> 1
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2
}

/**
 * セル数がそろっている行が多数派なら、その並びから列の位置を決める。
 *
 * 位置を **min/max ではなく中央値** で取るのがここの肝。min/max は**たった1行の
 * 壊れた行で列が広がる** ── 品目名に空白があって2つに割れた行があると、その右半分が
 * 「2列目」の一員として数えられ、2列目の範囲が名前のところまで伸びる。そうなると
 * 位置で入れ直しても直らない（境界がもう動いてしまっている）。
 * 中央値なら、そういう行が数行あっても列の位置は紙に刷られたとおりに出る。
 *
 * 並び順ではなく位置で決めるのは、x座標だけで束ねると**見出しと数字がずれる**ため。
 * 帳票の見出しは左寄せ、数量・単価は右寄せで刷られるので、`単価` の見出しは価格の
 * 少し左に来る。そろっている行から「何番目のセルか」で列を作れば、見出しも数字も
 * 同じ列に入る。
 */
function ordinalColumns(dense) {
  const count = new Map()
  for (const cells of dense) count.set(cells.length, (count.get(cells.length) ?? 0) + 1)
  let modal = 0, modalN = 0
  for (const [len, n] of count) if (n > modalN || (n === modalN && len > modal)) { modal = len; modalN = n }
  if (!modal || modalN < Math.max(2, dense.length * MODAL_MIN)) return null

  const lefts  = Array.from({ length: modal }, () => [])
  const rights = Array.from({ length: modal }, () => [])
  for (const cells of dense) {
    if (cells.length !== modal) continue
    cells.forEach((c, i) => { lefts[i].push(c.left); rights[i].push(c.right) })
  }
  const cols = lefts.map((ls, i) => {
    const l = median(ls), r = median(rights[i])
    return { left: l, right: Math.max(l, r) }
  })
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
  for (let i = 0; i + 1 < cols.length; i++) {
    const at = (cols[i].right + cols[i + 1].left) / 2
    // 必ず左から右へ。列の範囲が重なっている紙で境界が前後すると、
    // `columnAtEdges` の走査が破綻して列がまるごと空になる
    out.push(out.length && at <= out[out.length - 1] ? out[out.length - 1] : at)
  }
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
 * @param {{layout?: {cols,rows}, sections?: number}} opts 紙の割り方
 * @returns {string[][]} 行の配列。ページ順 → 段順（左の段を下まで → 次の段）に縦へ積む
 */
/**
 * ページのトークンを、段ごと・行ごとのセルに集める（列を決める前の段階）。
 * 表を組むときと、画面で「ここで分ける」と言われたときの両方から呼ぶ。
 */
function collectCells(pages, layout, rowFactor) {
  const all = []
  let secWidth = 0

  for (let pi = 0; pi < (pages?.length ?? 0); pi++) {
    const raw = readingTokens(pages[pi])
    if (!raw.length) continue
    const rowTol = rowTolOf(raw, rowFactor)
    const tokens = tableBodyTokens(raw, rowTol)
    if (!tokens.length) continue
    for (const band of bandsOf(tokens, layout.cols, layout.rows)) {
      const raw2 = []
      for (const t of tokens) {
        if (t.x < band.xMin || t.x >= band.xMax) continue
        if (t.y < band.yMin || t.y >= band.yMax) continue
        raw2.push(t)
      }
      // 帯ごとにも見出し帯を落とす。1枚の紙に「正」と「控」が縦に並ぶ帳票では、
      // 2つめの帯が自分の宛名・住所・表題を持っている（紙ぜんぶで1回だけ削っても残る）
      const inBand = tableBodyTokens(raw2, rowTol)
        .map(t => ({ text: t.text, x: t.x - band.origin, y: t.y, w: t.w, h: t.h }))
      if (!inBand.length) continue
      const left  = Math.min(...inBand.map(c => c.x))
      const right = Math.max(...inBand.map(c => c.x + c.w))
      secWidth = Math.max(secWidth, right - left)
      // 見出しから足す列はページごとに値が変わるので、行がどのページ由来かを持って回る
      for (const cells of rowsOf(inBand, rowTol)) all.push({ cells, page: pi })
    }
  }
  return { all, secWidth }
}

/**
 * 「この列をここで分ける」と言われたときの切りどころ。
 *
 * その列に入っている文字の区間をつないで、**いちばん広く空いているところ**を返す。
 * 位置を人に指定させるより、紙の上の空白に合わせたほうが速くて外れない。
 * 分けられる空白が無ければ null（画面はボタンを出さない）。
 */
export function suggestEdge(pages, opts = {}, colIndex = 0) {
  const { rowFactor = ROW_FACTOR, edges = [] } = opts
  const { all } = collectCells(pages, normLayout(opts), rowFactor)
  const inCol = []
  for (const { cells } of all) {
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
 * @param {{layout?: {cols:number,rows:number}, sections?: number, rowFactor?: number, edges?: number[]}} opts
 *   layout    = 紙の割り方（横×縦）。人が答えた枚数から `planLayout` が決める
 *   sections  = 横の段の数（`layout` の無い古いレシピ向け。横だけを意味する）
 *   rowFactor = 行としてまとめる高さ（文字の高さに対する倍率）
 *   edges     = 列の境界（段の原点からの相対x）。人が直したときだけ入る
 *   heads     = 見出し帯から足す列の**位置**（値ではなく位置を覚える）
 * @returns {{rows, edges, rowFactor, sections, layout, heads}}
 */
export function pdfPagesToTable(pages, opts = {}) {
  const { rowFactor = ROW_FACTOR, edges = null } = opts
  const layout = normLayout(opts)
  const heads = Array.isArray(opts.heads) ? opts.heads : []
  const { all, secWidth } = collectCells(pages, layout, rowFactor)

  // 見出しから足す列は、紙の列をぜんぶ決めたあとで右端に足す。
  // ページごとに値が違うので、行ごとに由来のページを見て入れる。
  const headVals = heads.length ? headValuesOf(pages, heads, rowFactor) : []
  const withHeads = (rows, rowPages) => {
    if (!heads.length) return rows
    const blank = heads.map(() => '')
    return rows.map((r, i) => [...r, ...(headVals[rowPages[i]] ?? blank)])
  }
  const made = (rows, rowPages, eg) => ({
    rows: withHeads(rows, rowPages), edges: eg,
    rowFactor, sections: layout.cols, layout, heads: heads.map(h => ({ ...h })),
  })
  const empty = made([], [], edges ?? [])
  if (!all.length) return empty

  // 人が境界を直していればそれが正。直していなければ自動で列を決める
  if (Array.isArray(edges) && edges.length) {
    const width = edges.length + 1
    const rows = [], rowPages = []
    for (const { cells, page } of all) {
      const row = new Array(width).fill('')
      for (const c of cells) {
        const i = columnAtEdges(edges, c)
        row[i] = joinCell(row[i], c.text)
      }
      if (row.some(v => v !== '')) { rows.push(row); rowPages.push(page) }
    }
    // 空の列も残す ── 人が引いた線を黙って消すと、直した手応えと画面が食い違う
    return made(rows, rowPages, [...edges])
  }

  const dense = all.filter(r => r.cells.length >= DENSE_CELLS).map(r => r.cells)
  const byOrdinal = ordinalColumns(dense)
  const cols = byOrdinal ? byOrdinal.cols : geometricColumns(all.flatMap(r => r.cells), secWidth)
  if (!cols.length) return empty

  /**
   * セルは**紙の上の位置**で列へ入れる。左から順に詰めない。
   *
   * 順に詰めると、セルの数が多数派とずれた行だけが横にずれる ── 品目名に空白があって
   * 2つに割れた行、値の欠けた行がそれで、**その行だけ1列分ずれる**形で出てくる。
   * しかも他の行は正しいので、先頭を見ただけでは気づけない。何ページもある紙では
   * 最後まで分からない。位置で入れれば、どの行も紙に刷られているところへ入り、
   * 欠けたところは空のまま残る。
   *
   * 列の位置そのものは `ordinalColumns`（そろっている行の何番目か＋中央値）で決めるので、
   * 左寄せの見出しと右寄せの数字は同じ列に入る。位置で入れることと両立する。
   */
  const posEdges = edgesOfColumns(cols)

  /**
   * **見出しの行だけは並び順で入れる。**
   *
   * 帳票の見出しは左寄せ、数量・単価は右寄せで刷られる。`数量` の見出しは自分の列の
   * ずっと左に来るので、位置で入れると `単価` と同じマスに落ち、右の列が全行空になる。
   * 見出しはセルの数がそろっているので、何番目かで入れれば必ず正しい列に入る。
   *
   * 見出しは**数字を1つも持たない最初の行**とその同じ並びの行（段組みの再掲）。
   * 「数字の無い行はぜんぶ見出し」にはしない ── 数字が隣へ押し出された壊れた行まで
   * 並び順で入れてしまい、直したかったずれがそのまま残る。
   */
  let headerKey = null
  for (const { cells } of all) {
    if (cells.length && !cells.some(c => isNumberish(c.text))) {
      headerKey = cells.map(c => c.text).join(ROW_KEY)
      break
    }
  }

  const out = [], outPages = []
  for (const { cells, page } of all) {
    const row = new Array(cols.length).fill('')
    const isHeaderRow = headerKey !== null && cells.length === cols.length &&
      cells.map(c => c.text).join(ROW_KEY) === headerKey
    const at = isHeaderRow
      ? cells.map((_, i) => i)
      : cells.map(c => columnAtEdges(posEdges, c))
    cells.forEach((c, i) => {
      row[at[i]] = joinCell(row[at[i]], c.text)
    })
    if (row.some(v => v !== '')) { out.push(row); outPages.push(page) }
  }

  // 空の列を落とし、残った列から境界を作る（この境界が画面での直しの出発点になる）
  const keep = []
  for (let i = 0; i < cols.length; i++) if (out.some(r => r[i] !== '')) keep.push(i)
  const rows = keep.length === cols.length ? out : out.map(r => keep.map(i => r[i]))
  return made(rows, outPages, edgesOfColumns(keep.map(i => cols[i])))
}

/**
 * そろっていない行（＝ずれている可能性が高い行）の番号。
 *
 * **ずれは目で探させない。** 1000行の表を上から見て「この行だけ1列ずれている」を
 * 見つけるのは人の仕事ではない。しかも先頭だけ見て安心すると、後ろのページで
 * ずれていても気づけない。
 *
 * 見ているのは2つ。
 *   ① 値の入っているセルの数が多数派と違う
 *      品目名に空白があって2つに割れた行（1つ多い）、値の欠けた行（1つ少ない）。
 *      これが「1行だけ1列分ずれる」の正体。見出しの行は多数派と同じ数なので出ない。
 *   ② いつも数字が入っている列に、数字でない値が入っている
 *      ①をすり抜けるずれ（多い側と少ない側が同じ行で起きたとき）を拾う。
 *
 * 見出しの行だけは対象外にする（当てると見出しがぜんぶ「あやしい」になり、印が
 * 意味を失う）。見出しは**数字を1つも持たない最初の行**とその同じ並びの行 ── 段組みの
 * 紙では同じ見出しが何度も出るため。「数字を持たない行はぜんぶ見出し」にはしない。
 * 数字がまるごと隣へ押し出された行こそが、いちばん見つけたいずれだから。
 *
 * @param {string[][]} rows
 * @param {{ignoreRight?: number}} [opts] ignoreRight = 右端から見ない列の数（見出しから足した列）
 * @returns {number[]} 行番号（0始まり）
 */
export function oddRowIndexes(rows, { ignoreRight = 0 } = {}) {
  const list = rows ?? []
  if (list.length < 3) return []
  const width = Math.max(0, list.reduce((n, r) => Math.max(n, r.length), 0) - ignoreRight)
  if (width < 2) return []

  const body = list.map(r => r.slice(0, width))
  const filledOf = (r) => r.filter(v => v !== '' && v != null).length

  // 値の入っているセルの数の多数派。見出しの行も同じ数なので一緒に数えてよい
  const count = new Map()
  for (const r of body) {
    const n = filledOf(r)
    if (n) count.set(n, (count.get(n) ?? 0) + 1)
  }
  let modal = 0, modalN = 0
  for (const [n, k] of count) if (k > modalN || (k === modalN && n > modal)) { modal = n; modalN = k }

  // いつも数字の列。そろっている行のうち、数字を持つ行（＝データの行）だけで見る
  const dataRows = body.filter(r => filledOf(r) === modal && r.some(isNumberish))
  const numericCol = []
  for (let c = 0; c < width; c++) {
    let filled = 0, num = 0
    for (const r of dataRows) {
      if (r[c] === '' || r[c] == null) continue
      filled++
      if (isNumberish(r[c])) num++
    }
    numericCol.push(filled >= 3 && num / filled >= 0.8)
  }

  // 見出しの行。数字を1つも持たない最初の行と、それと同じ並びの行（段組みの再掲）
  const KEY = ROW_KEY
  let headerKey = null
  for (const r of body) {
    if (filledOf(r) > 0 && !r.some(isNumberish)) { headerKey = r.join(KEY); break }
  }

  const out = []
  body.forEach((r, i) => {
    const n = filledOf(r)
    if (!n) return
    if (headerKey !== null && r.join(KEY) === headerKey) return
    if (modalN > 0 && n !== modal) { out.push(i); return }
    if (r.some((v, c) => numericCol[c] && v !== '' && v != null && !isNumberish(v))) out.push(i)
  })
  return out
}

/** 組み直した表をCSVテキストにする。以降は CSV・Excel とまったく同じ経路を通る。 */
export function rowsToCsv(rows) {
  return (rows ?? []).map(r => toCSVRow(r)).join('\r\n')
}

export function pdfPagesToCsv(pages, opts) {
  return rowsToCsv(pdfPagesToRows(pages, opts))
}
