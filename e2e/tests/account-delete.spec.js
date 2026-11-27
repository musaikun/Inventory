// account登録→削除: オーナーが設定から店ごと削除すると、その店のデータは読めず、同じ店舗コードでログインできない。
// 守るもの: DELETE /auth/account（account-deletion-contract.md）と、App の削除画面の流れ。
// 注意: 同じ店にログインし直すと、それまでのトークンは全部無効になる（handleLogin）。削除は最後にログインした端末から行う。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake, apiGet, PIN } from './helpers.js'

test('オーナーが店を削除すると、データは読めず、同じ店舗コードでログインできない', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  acceptDialogs(page)
  const code = await registerStore(page)
  await startFirstStocktake(page)
  await addItemWithQty(page, 'トマト', 7)
  await completeStocktake(page)

  // 削除前: このトークンで履歴が読める（削除後との比較のため、トークンを控える）
  const token = await page.evaluate(() => localStorage.getItem('_auth_token'))
  expect((await apiGet(page, `/store/${code}/history`)).status).toBe(200)

  // 設定 → アカウントの削除 → 暗証番号と店舗コード → 完全に削除する
  await page.getByText('設定', { exact: true }).last().click()
  await page.getByText('アカウントの削除').click()
  await page.getByRole('button', { name: 'アカウントを削除する…' }).click()
  await page.locator('#da-pin').fill(PIN)
  await page.locator('#da-confirm').fill(code)
  await page.getByRole('button', { name: '削除に進む' }).click()
  await page.getByRole('button', { name: '完全に削除する' }).click()
  await expect(page.getByText('アカウントを削除しました')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '閉じる' }).click()

  // 端末からはログイン情報が消え、控えたトークンでも、もう読めない
  expect(await page.evaluate(() => localStorage.getItem('_auth_token'))).toBeNull()
  expect((await apiGet(page, `/store/${code}/history`, { token })).status).toBe(401)

  // 別の端末から、同じ店舗コードと暗証番号では入れない
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  acceptDialogs(b)
  await login(b, code)
  await expect(b.getByText(/店舗コードが見つかりません|店舗コードまたは暗証番号を確認してください/)).toBeVisible()
  await expect(b.getByText('E2E店')).toHaveCount(0)

  await ctx.close()
  await ctxB.close()
})
