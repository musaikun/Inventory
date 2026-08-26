import { ref } from 'vue'

// ハンバーガーメニューから開く「設定」の対象セクション。
// null = 閉じている / 'all' | 'import' | 'device' | 'push' | 'general'
export const settingsSection = ref(null)

// 振り分けページ（AxisAssignModal）をアプリ全体で開く
export const showAxisAssign  = ref(false)
export const axisAssignInitial = ref(0)   // 開いたとき最初に選択する並び替え（0=①, 1=②）

// 発注スケジュール設定（OrderScheduleModal）。App の戻る/ESC 制御に載せるため共有状態にする。
export const showOrderSchedule = ref(false)
// 開いたときに目立たせるスケジュールの id（発注タブのカードから開いたとき）。null=指定なし
export const orderScheduleFocusId = ref(null)

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

// ── 画面内モーダルの戻る制御 ────────────────────────────────────────
//
// 振り分けページのように、全画面レイヤーの内側にさらにモーダルを持つ画面がある。
// App の `_closeTopLayer()` は親レイヤー（showAxisAssign など）しか知らないため、
// そのままでは内側のモーダルを開いたまま戻ると、モーダルではなく画面ごと閉じてしまう。
// 画面側が「今開いている内側のモーダル」を登録し、App は親レイヤーより先にこれを見る。
const _innerLayerClosers = new Set()

/**
 * 内側のモーダルを閉じる関数を登録する。閉じるものがあれば true を返す実装にする。
 * @param {() => boolean} closer
 * @returns {() => void} 解除関数（画面の unmount で必ず呼ぶ）
 */
export function registerInnerLayerCloser(closer) {
  _innerLayerClosers.add(closer)
  return () => { _innerLayerClosers.delete(closer) }
}

/** 内側のモーダルを1枚閉じたら true。戻る操作はそこで消費される */
export function consumeInnerLayerBack() {
  for (const closer of [..._innerLayerClosers].reverse()) {
    try { if (closer()) return true } catch (_) { /* closer の失敗で戻るを壊さない */ }
  }
  return false
}

// ── 閉じてはいけないモーダルの戻る制御（IMPORT-001）────────────────────────
//
// モーダル内の閉じるボタン・Escape・オーバーレイだけを塞いでも、Android/PWA と
// ブラウザの「戻る」は App の `_closeTopLayer()` が直接 view を切り替えるため、
// 子モーダルの requestClose() を通らずに unmount される。
// 過去棚卸取込では、そこで importBatchId と計画を失い、サーバーに残ったかもしれない
// 取込を取り消せなくなる（履歴画面に別の取消導線が無い）。
//
// そこでモーダル側が「今は戻るで閉じてはいけない」を登録し、App は最上位レイヤーの
// 判定より前にこれを見る。**何も閉じずに戻る操作だけを消費する。**
const _backGuards = new Set()

/**
 * 戻る操作を止める条件を登録する。`guard()` が true を返すあいだ、戻るは何も閉じない。
 * @param {() => boolean} guard
 * @returns {() => void} 解除関数（モーダルの unmount で必ず呼ぶ）
 */
export function registerModalBackGuard(guard) {
  _backGuards.add(guard)
  return () => { _backGuards.delete(guard) }
}

/** 戻るを止めるべきモーダルが開いているか */
export function isBackBlocked() {
  for (const guard of _backGuards) {
    try { if (guard()) return true } catch (_) { /* guard の失敗で戻るを壊さない */ }
  }
  return false
}
