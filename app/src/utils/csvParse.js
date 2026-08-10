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
 *   - CRLF / LF / CR、先頭 BOM、末尾改行なしを同じ結果へ寄せる
 *   - 空行は行番号をずらさずに捨てる（エラー表示の「N行目」をファイルと一致させる）
 *   - 桁区切りの `1,200` を 1 にしない。区切りとして妥当な形だけを 1200 と読む
 */

/** 閉じていない引用符（呼び出し側がUIの文言を選ぶためのコード） */
export const CSV_ERROR_UNCLOSED_QUOTE = 'unclosed_quote'

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

  const endCol = () => { cols.push(cur); cur = '' }
  const endRow = () => {
    endCol()
    // 空行（区切りも中身も無い行）は捨てる。行番号は line で別に進めているのでずれない。
    if (!(cols.length === 1 && cols[0].trim() === '')) rows.push({ line: recordLine, cols })
    cols = []
    started = false
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (!started && !inQuote) { recordLine = line; started = true }

    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++ }   // "" → " （エスケープ）
        else inQuote = false
      } else {
        if (ch === '\n') line++                        // 引用符内の改行は値の一部
        cur += ch
      }
      continue
    }

    if (ch === '"')  { inQuote = true; quoteOpenLine = line; continue }
    if (ch === ',')  { endCol(); continue }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); line++; continue }
    if (ch === '\n') { endRow(); line++; continue }
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
 * 数値セルの解釈。
 *
 * `"1,200"` は桁区切りとして 1200 と読む。**1 にはしない。**
 * 桁区切りとして成立しない `1,20` や `1,2345` は不正として返し、呼び出し側が
 * 行番号つきのエラーにする（黙って先頭だけ採用しない）。
 *
 * @param {*} raw
 * @returns {{ empty: true } | { value: number } | { invalid: true, raw: string }}
 */
export function parseNumericCell(raw) {
  const original = String(raw ?? '').trim()
  if (original === '') return { empty: true }

  let s = _toHalfWidth(original).replace(/[¥￥\s]/g, '')

  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')   // 桁区切り
  else if (!/^-?\d+(\.\d+)?$/.test(s)) return { invalid: true, raw: original }

  const n = Number(s)
  if (!Number.isFinite(n)) return { invalid: true, raw: original }
  return { value: n }
}
