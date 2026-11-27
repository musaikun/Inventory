// F-001: 同じ日の2回目の棚卸が、1回目を上書きしない。
// 守るもの: store_history を sessionId で一意にする保存（migration 0012・DATA-002）。日付だけで一意だった頃は
// 2回目が1回目を消した（bug-reports.md F-001）。別の端末から、D1 に2回分が別々に残っていることを確かめる。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake, overwriteQty, startAnotherStocktakeToday, apiGet } from './helpers.js'

test('同じ日に2回棚卸しても、両方が別々に残る', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  acceptDialogs(a)
  const code = await registerStore(a)
  await startFirstStocktake(a)
  await addItemWithQty(a, 'トマト', 7)
  await completeStocktake(a)

  await startAnotherStocktakeToday(a)
  await overwriteQty(a, 'トマト', 3)
  await completeStocktake(a)

  // 別の端末（localStorage 空）からサーバーの履歴を読む
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  acceptDialogs(b)
  await login(b, code)
  await expect(b.getByText('E2E店')).toBeVisible()
  const { status, body } = await apiGet(b, `/store/${code}/history`)
  expect(status).toBe(200)
  const today = body.filter((s) => s.date === body[0].date)
  expect(today).toHaveLength(2)
  expect(new Set(today.map((s) => s.sessionId)).size).toBe(2)
  const qtyOf = (s) => s.items.find((it) => it.item === 'トマト')?.qty
  expect(today.map(qtyOf).sort()).toEqual([3, 7])

  await ctxA.close()
  await ctxB.close()
})
