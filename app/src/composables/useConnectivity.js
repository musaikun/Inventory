import { ref } from 'vue'

// ブラウザのオンライン/オフライン状態を一元管理するシングルトン。
// 「接続が戻った」瞬間に登録済みコールバック（未送信データの再送など）を発火する。
export const isOnline = ref(typeof navigator === 'undefined' || navigator.onLine !== false)

const _reconnectCbs = new Set()
export function onReconnect(fn) { _reconnectCbs.add(fn); return () => _reconnectCbs.delete(fn) }

function _fireReconnect() {
  for (const fn of _reconnectCbs) { try { fn() } catch (_) {} }
}

let _inited = false
export function initConnectivity() {
  if (_inited || typeof window === 'undefined') return
  _inited = true
  window.addEventListener('online',  () => { isOnline.value = true; _fireReconnect() })
  window.addEventListener('offline', () => { isOnline.value = false })
}
