// 進行中在庫の D1 永続化（useInventoryPersistence）。App.vue から切り出したときの挙動を固定する。
// D1 との通信（useStore）だけ差し替え、在庫・セッションは実物を使う。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('./useStore.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveInventoryToD1:   vi.fn(),
  loadInventoryFromD1: vi.fn(),
  queuePendingSave:    vi.fn(),
}))

const { shopCode, saveInventoryToD1, loadInventoryFromD1, queuePendingSave } = await import('./useStore.js')
const { useInventory, applyRemoteUpdate, resetLocalData: resetInventory } = await import('./useInventory.js')
const { useSession } = await import('./useSession.js')
const { useInventoryPersistence } = await import('./useInventoryPersistence.js')

const { inventory } = useInventory()
const { pendingSession } = useSession()
let editing = true
const { flushInventoryToQueue, restoreInventoryFromD1 } = useInventoryPersistence({ isEditing: () => editing })

describe('useInventoryPersistence', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    localStorage.clear()
    resetInventory()
    await nextTick()
    vi.advanceTimersByTime(60_000)   // 前のテストの保存を出し切り、30秒の上限からも外す
    vi.clearAllMocks()
    shopCode.value = 'SHOP1'
    pendingSession.value = { id: 's1' }
    editing = true
  })
  afterEach(() => { vi.useRealTimers() })

  it('最後の保存から30秒たっていれば、変わった時点ですぐ保存する', async () => {
    applyRemoteUpdate('トマト', 3, '箱')
    await nextTick()
    expect(saveInventoryToD1).toHaveBeenCalledTimes(1)
    expect(saveInventoryToD1.mock.calls[0][0]).toMatchObject({ sessionId: 's1', inventory: { 'トマト': { qty: 3 } } })
  })

  it('続けて変わったときは3秒待ってまとめて1回保存する', async () => {
    applyRemoteUpdate('トマト', 3, '箱'); await nextTick()
    applyRemoteUpdate('トマト', 4, '箱'); await nextTick()
    vi.advanceTimersByTime(1000)
    applyRemoteUpdate('なす', 1, '本'); await nextTick()
    expect(saveInventoryToD1).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(saveInventoryToD1).toHaveBeenCalledTimes(2)
    expect(saveInventoryToD1.mock.calls[1][0].inventory).toMatchObject({ 'トマト': { qty: 4 }, 'なす': { qty: 1 } })
  })

  it('棚卸画面にいない・店舗コードが無いときは保存しない', async () => {
    editing = false
    applyRemoteUpdate('トマト', 3, '箱'); await nextTick()
    editing = true
    shopCode.value = ''
    applyRemoteUpdate('トマト', 4, '箱'); await nextTick()
    vi.advanceTimersByTime(5000)
    expect(saveInventoryToD1).not.toHaveBeenCalled()
  })

  it('待っている保存は、送らずに未送信キューへ移せる（認証失効の瞬間）', async () => {
    applyRemoteUpdate('トマト', 3, '箱'); await nextTick()    // すぐ保存（1回目）
    applyRemoteUpdate('トマト', 5, '箱'); await nextTick()    // 3秒待ち
    flushInventoryToQueue('SHOP1')
    expect(queuePendingSave).toHaveBeenCalledTimes(1)
    expect(queuePendingSave.mock.calls[0][0]).toBe('inventory')
    expect(queuePendingSave.mock.calls[0][1].inventory['トマト'].qty).toBe(5)
    expect(queuePendingSave.mock.calls[0][2]).toEqual({ shopCode: 'SHOP1' })
    vi.advanceTimersByTime(5000)
    expect(saveInventoryToD1).toHaveBeenCalledTimes(1)       // 待っていた保存は送らない
    flushInventoryToQueue('SHOP1')
    expect(queuePendingSave).toHaveBeenCalledTimes(1)        // 待ちが無ければ何もしない
  })

  it('D1 の在庫は、別セッションのものなら戻さず、端末が空なら戻す', async () => {
    loadInventoryFromD1.mockResolvedValueOnce({ sessionId: 'old', savedAt: 9, inventory: { 'トマト': { qty: 1, updatedAt: 9 } } })
    await restoreInventoryFromD1()
    expect(inventory['トマト']).toBeUndefined()

    loadInventoryFromD1.mockResolvedValueOnce({ sessionId: 's1', savedAt: 9, inventory: { 'トマト': { qty: 2, updatedAt: 9 } } })
    await restoreInventoryFromD1()
    expect(inventory['トマト']).toMatchObject({ qty: 2 })
  })

  it('端末の方が新しければ D1 の在庫で上書きしない', async () => {
    applyRemoteUpdate('トマト', 7, '箱', '', 100)
    loadInventoryFromD1.mockResolvedValueOnce({ sessionId: 's1', savedAt: 50, inventory: { 'トマト': { qty: 2, updatedAt: 50 } } })
    await restoreInventoryFromD1()
    expect(inventory['トマト']).toMatchObject({ qty: 7 })
  })
})
