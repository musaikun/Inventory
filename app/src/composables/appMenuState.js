import { ref } from 'vue'

// ハンバーガーメニューから開く「設定」の対象セクション。
// null = 閉じている / 'all' | 'import' | 'axis' | 'device' | 'push'
export const settingsSection = ref(null)
