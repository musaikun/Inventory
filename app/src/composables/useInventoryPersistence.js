// 進行中在庫の D1 永続化（端末紛失・キャッシュ消去からの復旧用）。
//
// もとは App.vue の中にあった。在庫・あとで数えるの印が変わるたびにデバウンスして D1 へ保存し、
// 起動・再開時には D1 から戻す。同期中はホストだけが書く（競合回避）、ソロは本人が書く。
// 呼ぶと watch を1つ張るので、App の setup で1回だけ呼ぶ。
import { watch } from 'vue'
import { useInventory, applyPersistedInventory } from './useInventory.js'
import { useSession } from './useSession.js'
import { useSync, mergeAuditLog } from './useSync.js'
import { shopCode, saveInventoryToD1, loadInventoryFromD1, queuePendingSave } from './useStore.js'
import { loadAuditFromD1 } from './useAuditSync.js'

// isEditing(): いま棚卸画面で入力中か（画面の状態は App が持つ）
export function useInventoryPersistence({ isEditing }) {
  const { inventory, recountFlags, isCompleted } = useInventory()
  const { pendingSession } = useSession()
  const { isActive: syncActive, isHost: syncIsHost } = useSync()

  // デバウンス保存。数量編集（品目数が変わらない更新）も捕捉するため inventory/recountFlags を deep watch。
  let _invD1Timer    = null
  let _invD1LastSave = 0
  function _inventoryPayload() {
    return {
      inventory:    { ...inventory },
      recountFlags: { ...recountFlags },
      sessionId:    pendingSession.value?.id ?? null,
      savedAt:      Date.now(),
    }
  }
  function _flushInventoryToD1() {
    _invD1Timer    = null
    _invD1LastSave = Date.now()
    saveInventoryToD1(_inventoryPayload())
  }
  function _persistInventoryToD1() {
    if (!shopCode.value || isCompleted.value) return
    if (!isEditing()) return
    if (syncActive.value && !syncIsHost.value) return
    clearTimeout(_invD1Timer)
    // 連続入力で3秒デバウンスが永遠にリセットされても、最大30秒で必ず保存
    if (Date.now() - _invD1LastSave > 30000) { _flushInventoryToD1(); return }
    _invD1Timer = setTimeout(_flushInventoryToD1, 3000)
  }
  watch([inventory, recountFlags], _persistInventoryToD1, { deep: true })

  // デバウンス中でまだ送っていない在庫を、送らずに未送信キューへ確定する（認証失効の瞬間用。
  // 呼ぶ側の説明は App の _flushDebouncedSavesToQueue）。
  function flushInventoryToQueue(code) {
    if (!code || !_invD1Timer) return
    clearTimeout(_invD1Timer)
    _invD1Timer = null
    queuePendingSave('inventory', _inventoryPayload(), { shopCode: code })
  }

  /**
   * 進行中セッションの変更履歴を D1 から取り込む（migration 0017）。
   *
   * これが「別の端末が入っても確認できる」経路。DO はルームの生存期間しか持たず、
   * 端末の下書きは1台にしか無いので、別端末で開いたときはここからしか復元できない。
   * 既にある分とは id で突き合わせて統合する（重複しない）。
   */
  async function restoreAuditFromD1(sessionId) {
    if (!sessionId || !shopCode.value) return
    mergeAuditLog(await loadAuditFromD1(sessionId))
  }

  // 起動・セッション再開時に D1 から進行中在庫を復旧（ローカルが空 or D1 が新しい場合のみ）
  async function restoreInventoryFromD1() {
    if (!shopCode.value || isCompleted.value) return
    const remote = await loadInventoryFromD1()
    if (!remote?.inventory) return
    // 別セッションのデータは無視（新規セッション開始後に旧データを読み込まない）
    if (remote.sessionId && pendingSession.value?.id && remote.sessionId !== pendingSession.value.id) return
    const localNewest = Object.values(inventory).reduce((m, e) => Math.max(m, e.updatedAt ?? 0), 0)
    if (Object.keys(inventory).length === 0 || (remote.savedAt ?? 0) > localNewest) {
      applyPersistedInventory(remote.inventory, remote.recountFlags)
    }
  }

  return { flushInventoryToQueue, restoreAuditFromD1, restoreInventoryFromD1 }
}
