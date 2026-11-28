// 品目の情報を直すと別の端末にも届き、名前を変えても在庫と記録がつながること。
// ITEM-001（品目を名前ではなく変わらない ID で結ぶ）の前後で守るもの。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake, startAnotherStocktakeToday } from './helpers.js'
import { openStockTab, openItemSheet, closeItemSheet, padMove, stockCell, stockRow } from './stockHelpers.js'

/** 品目シートの「編集する」から名前・単位・単価を直して保存 */
async function editItem(page, item, { name, unit, price }) {
  await openItemSheet(page, item)
  await page.getByRole('button', { name: '編集する' }).click()
  if (name != null) await page.locator('#if-name').fill(name)
  if (unit != null) await page.locator('#if-unit').fill(unit)
  if (price != null) await page.locator('#if-price').fill(String(price))
  await page.getByRole('button', { name: '保存', exact: true }).click()
}

async function storeWithCountedItem(browser, item, qty) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  acceptDialogs(page)
  const code = await registerStore(page)
  await startFirstStocktake(page)
  await addItemWithQty(page, item, qty)
  await completeStocktake(page)
  await openStockTab(page)
  return { ctx, page, code }
}

test('品目の単位・単価を直すと、別の端末にも届く', async ({ browser }) => {
  const { ctx: ctxA, page: a, code } = await storeWithCountedItem(browser, 'トマト', 7)
  await editItem(a, 'トマト', { unit: '箱', price: 300 })
  await expect(stockCell(a, 'トマト')).toContainText('箱')

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  acceptDialogs(b)
  await login(b, code)
  await openStockTab(b)
  await expect(stockCell(b, 'トマト')).toContainText('7')
  await expect(stockCell(b, 'トマト')).toContainText('箱')
  await ctxA.close()
  await ctxB.close()
})

test('品目の名前を変えても、在庫の数（棚卸＋入出庫）がつながったまま', async ({ browser }) => {
  // 今は品目を名前で結んでいるので、名前を変えると前の棚卸・入出庫が新しい名前に結びつかない。
  // ITEM-001 の I-4（ID で引く）で通るようになる。通ったら test.fail を外す
  test.fail()
  const { ctx, page: a } = await storeWithCountedItem(browser, 'トマト', 7)
  await openItemSheet(a, 'トマト')
  await padMove(a, 'in', 5)
  await a.locator('.is-reg').click()
  await expect(a.locator('.is-val')).toHaveText(/^\s*12/)
  await closeItemSheet(a)

  // 名前を変えられるのは棚卸の中の「品目を編集」。数は入れずに名前だけ変えて、棚卸を止めてホームへ
  await a.getByText('ホーム', { exact: true }).last().click()
  await startAnotherStocktakeToday(a)
  await a.getByRole('row', { name: /^トマト(\s|$)/ }).getByRole('button', { name: '編集' }).click()
  await a.locator('.edit-name-input').fill('ミニトマト')
  await a.getByRole('button', { name: '保存', exact: true }).click()
  await expect(a.getByRole('row', { name: /^ミニトマト(\s|$)/ })).toBeVisible()
  await a.locator('.home-btn').click()
  const pause = a.locator('.leave-btn').first()
  if (await pause.isVisible().catch(() => false)) await pause.click()

  await openStockTab(a)
  await expect(stockRow(a, 'ミニトマト')).toBeVisible()
  await expect(stockCell(a, 'ミニトマト')).toContainText('12', { timeout: 3000 })
  await ctx.close()
})
