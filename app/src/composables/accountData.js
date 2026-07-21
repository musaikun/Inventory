// アカウント境界（別アカウントでのログイン／登録）で、この端末に残る
// 前アカウントの業務データを全消去する。品目マスタ・棚卸・発注・入出庫・履歴・
// 辞書・進行中セッション・下書き・ホストトークン・同期セッション等が対象。
// 端末固有の設定（deviceId / deviceName / タップ設定）は残す。
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
