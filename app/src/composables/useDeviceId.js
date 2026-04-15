import { ref } from 'vue'

const DEVICE_ID_KEY   = '_device_id'
const DEVICE_NAME_KEY = '_device_name'

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

/** このデバイスを一意に識別する UUID（永続・変更不可） */
export const deviceId = _id

/** ユーザーが設定した端末名（例: "Aさん", "厨房", "ホール"） */
export const deviceName = ref(localStorage.getItem(DEVICE_NAME_KEY) ?? '')

/** 端末名を更新して永続化 */
export function setDeviceName(name) {
  deviceName.value = name.trim()
  localStorage.setItem(DEVICE_NAME_KEY, deviceName.value)
}
