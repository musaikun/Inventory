import { ref } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const DEVICE_ID_KEY   = STORAGE_KEYS.deviceId
const DEVICE_NAME_KEY = STORAGE_KEYS.deviceName

// ── デバイスID（UUID）永続生成 ────────────────────────────────────────────────
function _generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // フォールバック（古いブラウザ）
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

let _id = localStorage.getItem(DEVICE_ID_KEY)
if (!_id) {
  _id = _generateId()
  localStorage.setItem(DEVICE_ID_KEY, _id)
}

/**
 * このデバイスを一意に識別する UUID。
 * 通常運用では永続・不変（ログアウトやアカウント切替でも変わらない）。
 * アカウント削除の完了時だけ `resetLocalData()` で作り直す（D-019）。
 * `let` なのは ES module の live binding で import 側へ再生成後の値を伝えるため。
 */
export let deviceId = _id

/** ユーザーが設定した端末名（例: "Aさん", "厨房", "ホール"） */
export const deviceName = ref(localStorage.getItem(DEVICE_NAME_KEY) ?? '')

/** 端末名を更新して永続化 */
export function setDeviceName(name) {
  deviceName.value = name.trim()
  localStorage.setItem(DEVICE_NAME_KEY, deviceName.value)
}

/**
 * アカウント削除の完了時だけ呼ぶ（D-019）。ログアウト・アカウント切替では呼ばない。
 *
 * 端末IDと端末名を localStorage から消す。IDは削除後も同期・監査ログの送信元として
 * 参照されるため、消しっぱなしにせずメモリ上だけ新しい値へ差し替える。
 * こうすると「削除済みアカウントのIDを送り続ける」ことも「IDが空になる」ことも避けられる。
 * 永続化はしないので、次回起動時に通常の初期化経路で新しいIDが採番・保存される
 * （＝新規インストールと同じ状態になる）。
 */
export function resetLocalData() {
  try { localStorage.removeItem(DEVICE_ID_KEY) }   catch (_) {}
  try { localStorage.removeItem(DEVICE_NAME_KEY) } catch (_) {}
  deviceId = _generateId()
  deviceName.value = ''
}
