/**
 * アプリの中で訊く確認（User 2026-11-14）。ブラウザ標準の confirm() は、見た目が端末まかせで
 * ボタンが「OK／キャンセル」に固定され、何を押すと何が起きるのかをボタンに書けなかった。
 * 画面は `ConfirmSheet.vue`（App に1つだけ置く）。
 *
 * 標準の confirm() と違い、訊いている間も裏の処理は進む。呼ぶ側は、答えが返ったあとに
 * 前提（セッション・画面）が変わっていないかを確かめてから続けること。
 */
import { ref } from 'vue'

// { title, body, ok, cancel, danger, resolve } | null
export const confirmState = ref(null)

/**
 * @param {{ title: string, body?: string, ok?: string, cancel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>} OK なら true。既に別の確認を出している間は false（重ねて訊かない）
 */
export function askConfirm(opts) {
  if (confirmState.value) return Promise.resolve(false)
  return new Promise(resolve => {
    confirmState.value = { ok: 'OK', cancel: 'キャンセル', body: '', danger: false, ...opts, resolve }
  })
}

/**
 * 短い文字を1つ訊く（標準の prompt() の置き換え）。名前を付ける場面など。
 * `validate` が文を返す間は閉じずに、その文を入力欄の下に出す（標準の prompt は、だめな名前を
 * 入れると閉じてから別のお知らせが出て、入れ直しに最初から開き直す必要があった）。
 * @param {{ title: string, body?: string, placeholder?: string, initial?: string, ok?: string, cancel?: string, maxLength?: number, validate?: (v: string) => string }} opts
 * @returns {Promise<string|null>} 入れた文字（前後の空白は除く）。取りやめ・重ねて訊いた場合は null
 */
export function askText(opts) {
  if (confirmState.value) return Promise.resolve(null)
  return new Promise(resolve => {
    confirmState.value = {
      ok: 'OK', cancel: 'キャンセル', body: '', danger: false, placeholder: '', maxLength: 40, validate: null,
      ...opts, input: true, value: opts.initial ?? '', error: '', resolve,
    }
  })
}

/** 答えを返して閉じる（シートのボタン・戻る操作・画面の切り替わり） */
export function answerConfirm(ok) {
  const s = confirmState.value
  if (!s) return
  if (s.input) {
    // 文字を訊いている: OK は中身を確かめてから。空・だめな名前では閉じない
    let v = null
    if (ok) {
      v = String(s.value ?? '').trim()
      const err = !v ? '入力してください' : (s.validate?.(v) || '')
      if (err) { s.error = err; return }
    }
    confirmState.value = null
    s.resolve(v)
  } else {
    confirmState.value = null
    s.resolve(!!ok)
  }
  // 待たせていたお知らせがあれば続けて出す
  const next = _notices.shift()
  if (next) _showNotice(next)
}

/**
 * 知らせるだけ（標準の alert() の置き換え）。ボタンは「OK」1つ。答えを待たずに呼んでよい。
 * 確認を出している最中なら、それが閉じてから出す（知らせを落とさない）。
 * @param {string | { title: string, body?: string, ok?: string }} msg 文字列なら1行目を題、残りを本文にする
 */
export function notify(msg) {
  const o = typeof msg === 'string' ? splitMessage(msg) : msg
  return new Promise(resolve => {
    const n = { ok: 'OK', body: '', ...o, cancel: '', danger: false, resolve }
    if (confirmState.value) _notices.push(n)
    else _showNotice(n)
  })
}
const _notices = []
function _showNotice(n) { confirmState.value = n }

/** 「題\n本文…」の形の文を { title, body } に分ける */
export function splitMessage(msg) {
  const [title, ...rest] = String(msg ?? '').split('\n')
  return { title, body: rest.join('\n').replace(/^\n+/, '') }
}
