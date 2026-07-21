import { ref } from 'vue'

// ハンバーガーメニューから開く「設定」の対象セクション。
// null = 閉じている / 'all' | 'import' | 'device' | 'push' | 'general'
export const settingsSection = ref(null)

// 振り分けページ（AxisAssignModal）をアプリ全体で開く
export const showAxisAssign  = ref(false)
export const axisAssignInitial = ref(0)   // 開いたとき最初に選択する並び替え（0=①, 1=②）

