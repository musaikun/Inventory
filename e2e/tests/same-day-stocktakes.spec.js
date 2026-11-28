// F-001: 同じ日の2回目の棚卸が、1回目を上書きしない。
// 守るもの: store_history を sessionId で一意にする保存（migration 0012・DATA-002）。日付だけで一意だった頃は
// 2回目が1回目を消した（bug-reports.md F-001）。別の端末から、D1 に2回分が別々に残っていることと、
// 業務タブのその日の一覧で2件を別々に開けることを確かめる。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake, overwriteQty, startAnotherStocktakeToday, apiGet, qtyCell } from './helpers.js'

/** 業務タブ → 今日 → 一覧（その日の記録が時刻順に並ぶ） */
async function openTodayList(page) {
  await page.getByText('業務', { exact: true }).last().click()
  await page.locator('.jm-c.today').click()   // 今日のマス（数字で探すと月の境目で前月の同じ日を拾う）
  await page.getByText('一覧', { exact: true }).first().click()
}

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

  // 画面: 業務タブのその日の一覧に棚卸が2件並び、開くと 1回目は 7・2回目は 3
  await openTodayList(b)
  await expect(b.getByText('棚卸 完了 ・ 1品目')).toHaveCount(2)
  const seen = []
  for (let k = 0; k < 2; k++) {
    if (k > 0) await openTodayList(b)
    await b.getByText('棚卸 完了 ・ 1品目').nth(k).click()
    await expect(b.getByText('1/1品目入力済み')).toBeVisible()
    seen.push((await qtyCell(b, 'トマト').innerText()).trim())
    await b.getByText('‹ 戻る').click()
  }
  expect(seen).toEqual(['7', '3'])

  await ctxA.close()
  await ctxB.close()
})
