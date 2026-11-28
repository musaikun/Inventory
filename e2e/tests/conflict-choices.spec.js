// 競合の解決（自分／相手）と、ゲストが2人いるとき。
// 守るもの: ホストが選んだ値がゲスト全員に届き、競合に関わっていないゲストの入力も止めないこと（sync-spec）。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, startFirstStocktake, addItemWithQty, openRoom, joinAsGuest, qtyCell, overwriteQty, controllableRoomSocket } from './helpers.js'

async function roomWithTwoGuests(browser) {
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  acceptDialogs(host)
  await registerStore(host)
  await startFirstStocktake(host)
  await addItemWithQty(host, 'トマト', 7)
  await addItemWithQty(host, 'なす', 2)
  const invite = await openRoom(host)
  let net
  const g1 = await joinAsGuest(browser, invite, '鈴木', { setup: async (ctx) => { net = await controllableRoomSocket(ctx) } })
  const g2 = await joinAsGuest(browser, invite, '田中')
  for (const p of [g1.page, g2.page]) await expect(qtyCell(p, 'なす')).toHaveText(/^\s*2\b/)
  return {
    host, suzuki: g1.page, tanaka: g2.page, net,
    close: async () => { await g1.ctx.close(); await g2.ctx.close(); await hostCtx.close() },
  }
}

/** 鈴木が切断中に なす=4、その間にホストが なす=6 → 鈴木が戻るとホストに競合カード */
async function makeConflict({ host, suzuki, net }) {
  await net.cut()
  await overwriteQty(suzuki, 'なす', 4)
  await overwriteQty(host, 'なす', 6)
  await net.restore()
  const card = host.locator('.conflict-resolve-card').filter({ hasText: 'なす' })
  await expect(card).toBeVisible({ timeout: 45_000 })
  await expect(card).toContainText('鈴木: 4')
  return card
}

test('ホストが「自分」を選ぶと、ゲスト2人ともホストの値に揃う', async ({ browser }) => {
  const r = await roomWithTwoGuests(browser)
  const card = await makeConflict(r)
  await card.getByRole('button', { name: /^自分/ }).click()
  for (const p of [r.host, r.suzuki, r.tanaka]) await expect(qtyCell(p, 'なす')).toHaveText(/^\s*6\b/)
  await expect(r.suzuki.getByText('競合中 — ホストが解決中')).toHaveCount(0)
  await r.close()
})

test('ホストが「相手」を選ぶと、全員がゲストの値に揃う。競合中も別のゲストは他の品目を入れられる', async ({ browser }) => {
  const r = await roomWithTwoGuests(browser)
  const card = await makeConflict(r)
  // 競合中: 田中にも「なす」は解決待ちと出るが、トマトは入れられ、全員に届く
  await expect(r.tanaka.getByRole('row', { name: /^なす\s/ })).toContainText('競合中 — ホストが解決中')
  await overwriteQty(r.tanaka, 'トマト', 9)
  for (const p of [r.host, r.suzuki]) await expect(qtyCell(p, 'トマト')).toHaveText(/^\s*9\b/)

  await card.getByRole('button', { name: /^相手/ }).click()
  for (const p of [r.host, r.suzuki, r.tanaka]) await expect(qtyCell(p, 'なす')).toHaveText(/^\s*4\b/)
  for (const p of [r.suzuki, r.tanaka]) await expect(p.getByText('競合中 — ホストが解決中')).toHaveCount(0)
  await r.close()
})
