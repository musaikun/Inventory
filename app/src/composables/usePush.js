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
