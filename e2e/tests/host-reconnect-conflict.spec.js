// ホスト側の切断・再接続と、双方が同じ品目を変えたときの競合。
// 守るもの: ホストの再接続（hostToken で同じルームのホストに戻る）と再送、
// 再接続時の _mergeOnReconnect が「双方が変更し値が違う」品目を競合として人に選ばせること（sync-spec）。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, startFirstStocktake, addItemWithQty, openRoom, joinAsGuest, qtyCell, overwriteQty, controllableRoomSocket } from './helpers.js'

async function hostAndGuest(browser, { hostNet = false, guestNet = false } = {}) {
  const hostCtx = await browser.newContext()
  const net = {}
  if (hostNet) net.host = await controllableRoomSocket(hostCtx)
  const host = await hostCtx.newPage()
  acceptDialogs(host)
  await registerStore(host)
  await startFirstStocktake(host)
  await addItemWithQty(host, 'トマト', 7)
  await addItemWithQty(host, 'なす', 2)
  const invite = await openRoom(host)
  const { ctx: guestCtx, page: guest } = await joinAsGuest(browser, invite, '鈴木', {
    setup: guestNet ? async (ctx) => { net.guest = await controllableRoomSocket(ctx) } : undefined,
  })
  await expect(qtyCell(guest, 'なす')).toHaveText(/^\s*2\b/)
  return { host, guest, net, close: async () => { await guestCtx.close(); await hostCtx.close() } }
}

test('ホストの接続が切れている間に入れた数は、つながり直すとゲストに届く', async ({ browser }) => {
  const { host, guest, net, close } = await hostAndGuest(browser, { hostNet: true })

  await net.host.cut()
  await overwriteQty(host, 'トマト', 8)
  await guest.waitForTimeout(3000)
  await expect(qtyCell(guest, 'トマト')).toHaveText(/^\s*7\b/)

  await net.host.restore()
  await expect(qtyCell(guest, 'トマト')).toHaveText(/^\s*8\b/, { timeout: 45_000 })
  await expect(qtyCell(host, 'トマト')).toHaveText(/^\s*8\b/)
  // つながり直した後も、ホストはホストのまま（ゲストの入力が届く）
  await overwriteQty(guest, 'なす', 5)
  await expect(qtyCell(host, 'なす')).toHaveText(/^\s*5\b/)
  await close()
})

test('ゲストの切断中に双方が同じ品目を変えると、ホストに競合として選ばせ、選んだ値に揃う', async ({ browser }) => {
  const { host, guest, net, close } = await hostAndGuest(browser, { guestNet: true })

  await net.guest.cut()
  await overwriteQty(guest, 'なす', 4)   // ゲスト: 切断中に 4
  await overwriteQty(host, 'なす', 6)    // ホスト: その間に 6
  await net.guest.restore()

  // つながり直すと黙ってどちらかで上書きしない。ゲストは「ホストが解決中」で入力を止められ、
  // ホストに「同時入力」のカード（自分の 6 ／ ゲストの 4）が出る
  await expect(guest.getByRole('row', { name: /^なす\s/ })).toContainText('競合中 — ホストが解決中', { timeout: 45_000 })
  const card = host.locator('.conflict-resolve-card').filter({ hasText: 'なす' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('鈴木: 4')

  // ホストが合計を選ぶと、両方の画面が 10 に揃い、ゲストの競合表示も消える
  await card.getByRole('button', { name: /合計/ }).click()
  await expect(qtyCell(host, 'なす')).toHaveText(/^\s*10\b/)
  await expect(qtyCell(guest, 'なす')).toHaveText(/^\s*10\b/)
  await expect(guest.getByText('競合中 — ホストが解決中')).toHaveCount(0)
  await close()
})
