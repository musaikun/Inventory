// R-001 の型: 端末Aで締めた棚卸の明細が、端末B（localStorage 空）で読めること。
// 守るもの: GET /store/:code/history（snapshot + auditLog 同梱）。2026-11-02 に
// handleHistoryGet を空配列へ差し替えると落ちることを確認済み（mutation 確認）。
// 端末Bは別の browser context = 別の localStorage / Cookie。サーバー（D1/DO）経由でしか届かない。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake } from './helpers.js'

test('端末Aで完了した棚卸の明細を、端末Bで開ける', async ({ browser }) => {
  const deviceA = await browser.newContext()
  const a = await deviceA.newPage()
  const dialogsA = acceptDialogs(a)

  const code = await registerStore(a)
  await startFirstStocktake(a)
  await addItemWithQty(a, 'トマト', 7)
  await completeStocktake(a)
  // 完了の確認はアプリの中のシート（helpers の completeStocktake が確かめる）。標準のダイアログは出ない
  expect(dialogsA.some((m) => m.startsWith('棚卸を完了しますか'))).toBe(false)

  const deviceB = await browser.newContext()
  const b = await deviceB.newPage()
  acceptDialogs(b)
  await login(b, code)
  await b.getByText('レポート', { exact: true }).last().click()
  // 0.191.0 で絵文字をラインアイコンにしたので、文字だけで探す
  await expect(b.getByText('1品目', { exact: true })).toBeVisible()
  await b.getByText('この棚卸の詳細を見る').click()

  await expect(b.getByText('1/1品目入力済み')).toBeVisible()
  // 変更履歴（サーバーの auditLog 由来）: 何を・いくつ
  const entry = b.locator('.log-entry').filter({ has: b.locator('.log-item', { hasText: /^トマト$/ }) })
  await expect(entry).toHaveCount(1)
  await expect(entry.locator('.log-qty')).toHaveText(/^\s*7/)

  await deviceA.close()
  await deviceB.close()
})
