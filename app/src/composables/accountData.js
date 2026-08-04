// アカウント境界（別アカウントでのログイン／登録）で、この端末に残る
// 前アカウントの業務データを全消去する。品目マスタ・棚卸・発注・入出庫・履歴・
// 辞書・進行中セッション・下書き・ホストトークン・同期セッション等が対象。
// 端末固有の設定（deviceId / deviceName / 天気の位置情報 / タップ設定）は残す。
// アカウント削除の完了時だけは端末固有データも消す → clearDeletedAccountLocalData（D-019）。
//
// 背景: config/inventory/orders/movements 等は shopCode で名前空間を分けない
// 固定 localStorage キー＋モジュールスコープのメモリに保持される。境界で消さないと
// 同一ブラウザでアカウントを切り替えた際に前アカウントのデータが見えてしまう（漏洩）。

import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { resetLocalData as resetConfig }    from './useConfig.js'
import { resetLocalData as resetInventory } from './useInventory.js'
import { resetLocalData as resetOrders }    from './useOrders.js'
import { resetLocalData as resetMovements } from './useMovements.js'
import { resetLocalData as resetMovementDraft } from './useMovementDraft.js'
import { resetLocalData as resetDayNotes }  from './useDayNotes.js'
import { resetLocalData as resetHistory }   from './useHistory.js'
import { resetLocalData as resetSession }   from './useSession.js'
import { resetLocalData as resetDeviceId }  from './useDeviceId.js'
import { resetLocalData as resetWeather }   from './useWeather.js'

const _DRAFT_PREFIXES = ['inv_draft_', 'order_draft_']

export function clearLocalAccountData() {
  resetConfig()
  resetInventory()
  resetOrders()
  resetMovements()
  resetMovementDraft()
  resetDayNotes()
  resetHistory()
  resetSession()

  try {
    localStorage.removeItem(STORAGE_KEYS.syncSession)
    localStorage.removeItem(STORAGE_KEYS.pendingSession)
    localStorage.removeItem(STORAGE_KEYS.pdfProfiles)
    localStorage.removeItem(STORAGE_KEYS.deleteRequestId)  // 別アカウントへ跨る削除requestId残存を防ぐ
    // ホストトークン（店舗ごと）・下書き（セッション/発注ごと）はプレフィックス走査で消す
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith(STORAGE_KEYS.hostTokenPrefix) || _DRAFT_PREFIXES.some(p => k.startsWith(p))) {
        localStorage.removeItem(k)
      }
    }
  } catch (_) {}
}

// アカウント削除の完了時だけ呼ぶ（PLAY-003 / DS-01）。
// 業務データに加えて所有者マーカー自体を消す。ログアウト・アカウント切替では消さない:
// dataOwner は「この端末の localStorage が誰のものか」を認証状態と独立に追う値で、
// ログアウトで消すと再ログイン時に切替を検出できず、前アカウントのデータが残る。
// 一方、削除後は所有者ごと消えるべきで、残すと削除済みアカウントの店舗コードが端末に残留する。
export function clearDeletedAccountLocalData() {
  try {
    clearLocalAccountData()
  } finally {
    // 個別composableのresetが例外になっても、削除済みaccountの識別子だけは必ず消去を試みる。
    try { localStorage.removeItem(STORAGE_KEYS.dataOwner) } catch (_) {}
    clearDeviceLocalData()
  }
}

// アカウント削除の完了時だけ呼ぶ（D-019）。端末固有データを消す。
// 端末ID・端末名・天気の位置情報とキャッシュは業務データではないため
// clearLocalAccountData（ログアウト・アカウント切替）の対象には含めない。
// 片方が例外になっても、もう片方の消去は必ず試みる。
export function clearDeviceLocalData() {
  try { resetDeviceId() } catch (_) {}
  try { resetWeather() }  catch (_) {}
}
