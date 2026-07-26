import { ref } from 'vue'
import { shopCode } from './useStore.js'
import { HTTP_BASE, apiFetch } from '../utils/api.js'

const _KEY = 'tanaoro_push_subscribed'

export const pushSubscribed = ref(localStorage.getItem(_KEY) === '1')
export const pushLoading    = ref(false)
export const pushSupported  = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function _urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4)
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function subscribePush() {
  if (!pushSupported) return false
  pushLoading.value = true
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const { key } = await apiFetch('/api/push/vapid-key')
    if (!key) return false

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: _urlBase64ToUint8Array(key),
    })

    const code = shopCode.value
    if (code) {
      await apiFetch(`/store/${code}/push/subscribe`, {
        method: 'POST',
        body:   JSON.stringify(sub.toJSON()),
      })
    }

    pushSubscribed.value = true
    localStorage.setItem(_KEY, '1')
    return true
  } catch (_) {
    return false
  } finally {
    pushLoading.value = false
  }
}

// アカウント削除の成功後などに、サーバー通信なしで端末の購読だけ解除する。
// 削除成功時点でサーバー側の購読は既に削除済み・token も失効しているため、
// remote DELETE を呼ぶと 401 になり、その throw で browser の unsubscribe に到達せず、
// さらに失効ハンドラを誤発火させる。ここでは local の PushSubscription 解除だけを行う。
export async function unsubscribePushLocal() {
  // 表示用の購読フラグは環境に関わらず必ず落とす（削除後に「通知ON」表示が残らないように）。
  // Push 非対応環境でもここで消してから抜ける。
  pushSubscribed.value = false
  try { localStorage.removeItem(_KEY) } catch (_) {}
  if (!pushSupported) return false
  try {
    // `serviceWorker.ready` は SW 未登録だと永久に解決せず、呼び出し元（削除の finalize）を
    // ハングさせる。`getRegistration()` は登録が無ければ即 undefined を返すので hang しない。
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) await sub.unsubscribe()
  } catch (_) { /* best-effort（購読が無い/解除済みでも成功扱い） */ }
  return true
}

export async function unsubscribePush() {
  if (!pushSupported) return false
  pushLoading.value = true
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const code = shopCode.value
      if (code) {
        await apiFetch(`/store/${code}/push/subscribe`, {
          method: 'DELETE',
          body:   JSON.stringify({ endpoint: sub.endpoint }),
        })
      }
      await sub.unsubscribe()
    }
    pushSubscribed.value = false
    localStorage.removeItem(_KEY)
    return true
  } catch (_) {
    return false
  } finally {
    pushLoading.value = false
  }
}
