// 在庫の数＝棚卸＋入庫−出庫（PROD-001）が、別の端末でも同じになること。
// ITEM-001 I-4（品目を名前ではなく ID で引く）の前に、名前で結んでいる流れ（棚卸の明細・入出庫・在庫の数）を守るために置く。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake } from './helpers.js'
import { openStockTab, openItemSheet, closeItemSheet, padMove, stockCell } from './stockHelpers.js'

test('棚卸の数に入庫・出庫が足し引きされ、別の端末でも同じ在庫になる', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  acceptDialogs(a)
  const code = await registerStore(a)
  await startFirstStocktake(a)
  await addItemWithQty(a, 'トマト', 7)
  await completeStocktake(a)

  await openStockTab(a)
  await expect(stockCell(a, 'トマト')).toContainText('7')
  await openItemSheet(a, 'トマト')
  await padMove(a, 'in', 5)
  await padMove(a, 'out', 2)
  await a.locator('.is-reg').click()
  await expect(a.locator('.is-val')).toHaveText(/^\s*10/)
  await expect(a.locator('.is-basis')).toContainText('＋入庫 5 −出庫 2')
  await closeItemSheet(a)
  await expect(stockCell(a, 'トマト')).toContainText('10')
  await expect(stockCell(a, 'トマト')).toContainText('棚卸から')

  // 別の端末（localStorage 空）: 棚卸の明細と入出庫はサーバーから届く
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  acceptDialogs(b)
  await login(b, code)
  await openStockTab(b)
  await expect(stockCell(b, 'トマト')).toContainText('10')

  await ctxA.close()
  await ctxB.close()
})
