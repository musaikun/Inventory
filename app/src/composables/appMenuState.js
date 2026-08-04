import { ref } from 'vue'

// ハンバーガーメニューから開く「設定」の対象セクション。
// null = 閉じている / 'all' | 'import' | 'device' | 'push' | 'general'
export const settingsSection = ref(null)

// 振り分けページ（AxisAssignModal）をアプリ全体で開く
export const showAxisAssign  = ref(false)
export const axisAssignInitial = ref(0)   // 開いたとき最初に選択する並び替え（0=①, 1=②）

// 発注スケジュール設定（OrderScheduleModal）。App の戻る/ESC 制御に載せるため共有状態にする。
export const showOrderSchedule = ref(false)

// アカウント削除モーダル（DeleteAccountModal）。設定内の danger 区画から開き、
// App の戻る/ESC 制御に載せるため共有状態にする。
export const showDeleteAccount = ref(false)

// DeleteAccountModal は設定内と公開削除ページの2経路から開く。
// App の共通 Back 制御へ現在のモーダルだけを登録し、親が持つ表示 state に依存せず閉じる。
let _deleteAccountBackHandler = null

export function registerDeleteAccountBackHandler(handler) {
  _deleteAccountBackHandler = handler
  return () => {
    if (_deleteAccountBackHandler === handler) _deleteAccountBackHandler = null
  }
}

export function consumeDeleteAccountBack() {
  if (!_deleteAccountBackHandler) return false
  _deleteAccountBackHandler()
  return true
}

