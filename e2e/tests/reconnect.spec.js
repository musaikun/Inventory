// 再接続: ゲストの接続が切れている間に入れた数は、つながり直すとホストに届く（再送）。
// 守るもの: useSync の再接続（1.5 / 3 / 6 / 12 / 30 秒の backoff）と、joined 受信時の _mergeOnReconnect が
// 「手元だけ新しい」品目を再送すること（sync-spec「lifecycle・再接続」）。
// 2026-11-25: useSync の再送（case 'local' の broadcastUpdate）を外すと、このテストが落ちることを確認済み。
// 接続は routeWebSocket の中継で本当に切る（setOffline だけでは WebSocket が切れず、再接続を通らない）。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, startFirstStocktake, addItemWithQty, openRoom, joinAsGuest, qtyCell, overwriteQty, controllableRoomSocket } from './helpers.js'

test('ゲストの接続が切れている間に入れた数は、つながり直すとホストに届く', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  acceptDialogs(host)
  await registerStore(host)
  await startFirstStocktake(host)
  await addItemWithQty(host, 'トマト', 7)
  await addItemWithQty(host, 'なす', 2)
  const invite = await openRoom(host)

  let net
  const { ctx: guestCtx, page: guest } = await joinAsGuest(browser, invite, '鈴木', {
    setup: async (ctx) => { net = await controllableRoomSocket(ctx) },
  })
  await expect(qtyCell(guest, 'なす')).toHaveText(/^\s*2\b/)
  expect(net.opened).toBe(1)

  // 接続が切れる → その間に入れる。ゲストの手元には出るが、ホストには届かない
  await net.cut()
  await overwriteQty(guest, 'なす', 4)
  await host.waitForTimeout(3000)
  await expect(qtyCell(host, 'なす')).toHaveText(/^\s*2\b/)

  // つながり直すと（backoff の最大 30 秒を見込む）再送され、ホストに届く
  await net.restore()
  await expect(qtyCell(host, 'なす')).toHaveText(/^\s*4\b/, { timeout: 45_000 })
  expect(net.opened).toBeGreaterThanOrEqual(2)   // 本当に張り直した
  // 再接続でサーバーの古い値に戻されていない
  await expect(qtyCell(guest, 'なす')).toHaveText(/^\s*4\b/)

  await guestCtx.close()
  await hostCtx.close()
})
