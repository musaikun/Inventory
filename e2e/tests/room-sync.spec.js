// host/guest 同期: ホストがルームを作り、招待リンクから入ったゲストの入力がホストに、ホストの入力がゲストに届く。
// 守るもの: RoomDO の join（ゲストはホストの品目リスト・在庫に揃う）と update の配信（sync-spec「接続・join認可」）。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, startFirstStocktake, addItemWithQty, openRoom, joinAsGuest, qtyCell, overwriteQty } from './helpers.js'

test('ゲストはホストの在庫に揃い、互いの入力が相手の画面に出る', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  acceptDialogs(host)
  await registerStore(host)
  await startFirstStocktake(host)
  await addItemWithQty(host, 'トマト', 7)
  await addItemWithQty(host, 'なす', 2)
  const invite = await openRoom(host)

  // 招待リンクで入ったゲスト（別の端末 = 別の localStorage）は、ホストの品目と数に揃う
  const { ctx: guestCtx, page: guest } = await joinAsGuest(browser, invite, '鈴木')
  await expect(qtyCell(guest, 'トマト')).toHaveText(/^\s*7\b/)
  await expect(qtyCell(guest, 'なす')).toHaveText(/^\s*2\b/)

  // ゲストの入力 → ホスト
  await overwriteQty(guest, 'なす', 5)
  await expect(qtyCell(host, 'なす')).toHaveText(/^\s*5\b/)

  // ホストの入力 → ゲスト
  await overwriteQty(host, 'トマト', 9)
  await expect(qtyCell(guest, 'トマト')).toHaveText(/^\s*9\b/)

  await guestCtx.close()
  await hostCtx.close()
})
