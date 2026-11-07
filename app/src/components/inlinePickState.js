// InlinePick の「今どれが開いているか」（画面に1つだけ開く）
import { ref } from 'vue'

export const openPick = ref(null)
let _n = 0
export const nextPickId = () => `ip${++_n}`
