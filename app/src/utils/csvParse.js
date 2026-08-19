/**
 * CSV の共通トークナイザと数値セル解釈（IMPORT-001）。
 *
 * 品目取込・棚卸結果取込・納品取込がそれぞれ独自の1行パーサを持っていて、
 * 同じ欠陥を3か所で再現していた。解釈をここへ一本化する。
 *
 * このモジュールが引き受ける契約:
 *   - `""` は値の中の `"` 1文字（エスケープされた引用符）として扱う
 *   - 引用符の中の改行・カンマは区切りにしない（1セルの一部）
 *   - 閉じていない引用符は黙って受理せず、開始行つきのエラーにする
 *   - **引用符はセルの先頭でだけ開始でき、閉じたら区切り・改行・EOFまで**
 *     （`foo"bar"baz` を黙って `foobarbaz` にしない。品目名が無通知で変わる）
 *   - CRLF / LF / CR、先頭 BOM、末尾改行なしを同じ結果へ寄せる
 *   - 空行は行番号をずらさずに捨てる（エラー表示の「N行目」をファイルと一致させる）
 *   - 桁区切りの `1,200` を 1 にしない。区切りとして妥当な形だけを 1200 と読む
 */

/** 閉じていない引用符（呼び出し側がUIの文言を選ぶためのコード） */
export const CSV_ERROR_UNCLOSED_QUOTE = 'unclosed_quote'

/**
 * 引用符の位置が不正（セル途中で開いた／閉じたあとに文字が続く）。
 *
 * 修正前は「`"` が来たら常に引用開始」「閉じたら通常文字も継続」だったため、
 * `foo"bar"baz` が**エラーなしで `foobarbaz`** になっていた。引用符を落として
 * つなげるので、品目名・単位などが無通知で別の文字列に変わる。
 * 直せるのは書いた本人だけなので、推測で直さず構造エラーにする。
 */
export const CSV_ERROR_BAD_QUOTE = 'bad_quote'

/**
 * CSV全体をレコード配列へ分解する。
 *
 * 戻り値の `line` は**ファイル上の物理行番号**（レコード開始行）。引用符内の改行で
 * レコードが複数行にまたがる場合も、そのレコードの開始行を指す。
 *
 * @param {string} text
 * @returns {{ rows: Array<{ line: number, cols: string[] }>, error: null | { code: string, line: number, message: string } }}
 */
export function tokenizeCSV(text) {
  const src = String(text ?? '').replace(/^﻿/, '')

  const rows = []
  let cols = []
  let cur  = ''
  let inQuote = false
  let line = 1           // 現在の物理行
  let recordLine = 1     // 組み立て中のレコードの開始行
  let started = false    // 組み立て中のレコードに文字が入ったか
  let quoteOpenLine = 0  // 未閉じ引用符の報告用

  // セル単位の状態。引用符の位置を厳密に見るために持つ。
  //   quotedDone  … このセルの引用セクションが閉じた（以降は区切り・改行・空白だけ）
  //   contentSeen … 引用符の外で非空白文字を見た（＝もう先頭ではない）
  let quotedDone  = false
  let contentSeen = false

  const resetCell = () => { quotedDone = false; contentSeen = false }
  const endCol = () => { cols.push(cur); cur = ''; resetCell() }
  const endRow = () => {
    endCol()
    // 空行（区切りも中身も無い行）は捨てる。行番号は line で別に進めているのでずれない。
    if (!(cols.length === 1 && cols[0].trim() === '')) rows.push({ line: recordLine, cols })
    cols = []
    started = false
  }

  const badQuote = (atLine, why) => ({
    rows: [],
    error: {
      code: CSV_ERROR_BAD_QUOTE,
      line: atLine,
      message: `${atLine}行目の引用符（"）の位置が不正です（${why}）`,
    },
  })

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (!started && !inQuote) { recordLine = line; started = true }

    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++ }   // "" → " （エスケープ）
        else { inQuote = false; quotedDone = true }
      } else {
        if (ch === '\n') line++                        // 引用符内の改行は値の一部
        cur += ch
      }
      continue
    }

    if (ch === '"') {
      // 引用符で始められるのはセルの先頭だけ。`foo"bar"` の `"` や、
      // 一度閉じたあとの `"ab""cd"` 相当を「引用開始」として受け入れない。
      if (quotedDone)  return badQuote(line, '引用符が閉じたあとに再び引用符があります')
      if (contentSeen) return badQuote(line, 'セルの途中では引用符を開始できません')
      cur = ''                       // 引用符の前にあった空白は値に含めない
      inQuote = true
      quoteOpenLine = line
      continue
    }
    if (ch === ',')  { endCol(); continue }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); line++; continue }
    if (ch === '\n') { endRow(); line++; continue }

    // 引用符の前後の空白だけは許す（手書きCSVの `a, "b,c"` を構造エラーにしない）。
    // 値そのものは変わらないので、無通知の改変にはあたらない。
    if (ch === ' ' || ch === '\t') { cur += ch; continue }

    if (quotedDone) return badQuote(line, '引用符が閉じたあとに文字が続いています')
    contentSeen = true
    cur += ch
  }

  if (inQuote) {
    return {
      rows: [],
      error: {
        code: CSV_ERROR_UNCLOSED_QUOTE,
        line: quoteOpenLine,
        message: `${quoteOpenLine}行目の引用符（"）が閉じていません`,
      },
    }
  }
  if (started) endRow()

  return { rows, error: null }
}

/** 1行だけをセルへ分解する（ヘッダ判定など、行単位で十分な場面用） */
export function parseCSVLine(line) {
  const { rows } = tokenizeCSV(String(line ?? ''))
  return rows[0]?.cols ?? ['']
}

// 全角の数字・記号を半角へ寄せる（Excel から貼られた表でよく混ざる）
const FULLWIDTH_SRC = '０１２３４５６７８９．，－'
const FULLWIDTH_DST = '0123456789.,-'
function _toHalfWidth(s) {
  return s.replace(/[０-９．，－]/g, c => FULLWIDTH_DST[FULLWIDTH_SRC.indexOf(c)])
}

/**
 * 数値セルの解釈。**全取込入口（品目・棚卸結果・納品・過去棚卸）の唯一の実装。**
 *
 * 許可する形式はこれだけ:
 *   - 整数 `120` / 小数 `1.5` / 先頭の符号 `-3`（負の可否は呼び出し側が決める）
 *   - 3桁区切り `1,200` `1,234,567` `1,200.50` → カンマを外して読む
 *   - 前後の空白、**先頭の** `¥` `￥` を1個、全角数字・全角ピリオド・全角カンマ・全角マイナス
 *
 * 拒否するもの（`parseFloat` の前方一致受理をやめた理由）:
 *   `12abc` → 12 / `abc100` → NaN→0扱い / `1,20` → 1 / `1 2` → 1 /
 *   `NaN` `Infinity` `1e5` `--1` `1.2.3` `.` `-`
 * これらは黙って正常値へ寄せず、不正として返して呼び出し側が行番号つきで見せる。
 *
 * 通貨記号は**先頭の1個だけ**。任意位置から削り取ると `1¥2` が 12、`100￥` が 100、
 * `¥1¥2` が 12 として通り、元のセルに無い数値を作ってしまう。
 *
 * @param {*} raw
 * @returns {{ empty: true } | { value: number } | { invalid: true, raw: string }}
 */
export function parseNumericCell(raw) {
  const original = String(raw ?? '').trim()
  if (original === '') return { empty: true }

  // 空白は「桁区切りの代わり」ではなく混入とみなす。`1 2` を 12 にしない。
  if (/\s/.test(original)) return { invalid: true, raw: original }

  let s = _toHalfWidth(original).replace(/^[¥￥]/, '')   // 先頭の通貨記号は1個だけ外す
  if (/[¥￥]/.test(s)) return { invalid: true, raw: original }   // 残っていれば位置違いか重複

  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')   // 桁区切り
  else if (!/^-?\d+(\.\d+)?$/.test(s)) return { invalid: true, raw: original }

  const n = Number(s)
  // 上の正規表現を通れば NaN / Infinity にはならないが、桁あふれ（1e309 相当の長い数字列）
  // だけは Infinity になりうるので最後に必ず確認する。
  if (!Number.isFinite(n)) return { invalid: true, raw: original }
  return { value: n }
}

/**
 * 数値セルを読み、不正なら**行番号・列・元の値・理由**を持つエラーを返す。
 * 4つの取込入口が同じ形のエラーを作るための共通入口（画面はこの形だけを描く）。
 *
 * @param {*} raw
 * @param {object} opts
 * @param {number}  opts.line          ファイル上の行番号
 * @param {number}  [opts.column]      列インデックス（0始まり・不明なら null）
 * @param {string}  [opts.columnLabel] 画面に出す列名
 * @param {boolean} [opts.positive]    0以下を不正にする（単価・入数など）
 * @param {boolean} [opts.allowNegative] 負数を許可する（既定は不許可）
 * @param {number}  [opts.max]         上限（この値ちょうどは受理・超過は拒否）。
 *                                     値は utils/importLimits.js（＝worker の契約）から渡す。
 *                                     渡さなければ上限判定をしない
 * @returns {{ empty: true } | { value: number } | { error: object }}
 */
export function readNumericCell(raw, {
  line, column = null, columnLabel = '', positive = false, allowNegative = false, max = null,
} = {}) {
  const original = String(raw ?? '').trim()
  const parsed   = parseNumericCell(raw)
  const fail = (reason) => ({ error: { line, column, columnLabel, value: original, reason } })

  if (parsed.empty)   return { empty: true }
  if (parsed.invalid) return fail(`${columnLabel || '数値'}「${original}」は数値として読めません`)

  const n = parsed.value
  if (positive && !(n > 0)) {
    return fail(`${columnLabel || '数値'}「${original}」は0より大きい数値にしてください`)
  }
  if (!allowNegative && n < 0) {
    return fail(`${columnLabel || '数値'}「${original}」は0以上の数値にしてください`)
  }
  // 上限はサーバーと同じ値。ここで弾かないと、確定の途中でサーバーが拒否して
  // 「一部だけ入った」状態になる。
  if (max !== null && max !== undefined && n > max) {
    return fail(`${columnLabel || '数値'}「${original}」は上限（${max.toLocaleString('en-US')}）を超えています`)
  }
  return { value: n }
}

/**
 * CSVの1セルを書き出す。カンマ・引用符・改行を含む値を壊さない**唯一のエスケープ実装**。
 *
 * `"${v}"` で囲むだけの実装は、値の中の `"` でセルが割れる（`5" 皿` → `5 皿` や列ずれ）。
 * ここでは RFC4180 どおり `"` を `""` へ倍にしてから囲む。tokenizeCSV と対で往復する。
 *
 * @param {*} value
 * @param {object} [opts]
 * @param {boolean} [opts.formulaGuard] `=+-@|` 始まりの文字列に `'` を付ける（表計算のフォーミュラ実行対策）
 */
export function csvEscapeCell(value, { formulaGuard = false } = {}) {
  let s = value === undefined || value === null ? '' : String(value)
  if (s === '') return ''
  if (formulaGuard && /^[=+\-@|]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** セル配列を1行のCSV文字列にする（区切りはカンマ固定） */
export function toCSVRow(cells, opts) {
  return cells.map(c => csvEscapeCell(c, opts)).join(',')
}
