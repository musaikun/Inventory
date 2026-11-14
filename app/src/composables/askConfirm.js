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

/** 答えを返して閉じる（シートのボタン・戻る操作・画面の切り替わり） */
export function answerConfirm(ok) {
  const s = confirmState.value
  if (!s) return
  confirmState.value = null
  s.resolve(!!ok)
}
