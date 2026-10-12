// 画面の上に出る一行の知らせ（トースト）。
//
// App のあちこち（同期の受信・完了・取込・品目の登録など）から出すので、状態はモジュールに1つだけ置き、
// 表示は AppToast.vue が受け持つ。新しいトーストが来たら前のものは置き換える（重ねない）。
import { ref } from 'vue'

// type: 'default' | 'success' | 'error' | 'warning' | 'join' | 'leave' | 'update'
export const toastMsg  = ref('')
export const toastType = ref('default')
export const toastShow = ref(false)
let toastTimer = null

export function showToast(msg, duration = 2600, type = 'default') {
  clearTimeout(toastTimer)
  toastMsg.value  = msg
  toastType.value = type
  toastShow.value = true
  toastTimer = setTimeout(() => (toastShow.value = false), duration)
}
