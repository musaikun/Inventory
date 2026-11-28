// スタッフ: 招待 → 申請 → 承認 → ログイン。オーナーとスタッフの2台がルームなしで同じ在庫になり、
// スタッフの権限に合わせて画面が変わる。
// 守るもの: スタッフのログイン（migration 0022〜）、オーナーのトークンがスタッフのログインで切れないこと、
// 入出庫がサーバー経由で別の端末に届くこと、オーナーだけの操作（D-031 アカウント削除）が出ないこと。
// オーナーが2台目でログインすると1台目のトークンは無効になる（handleLogin）ので、「同時に2台」はスタッフで作る。
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, startFirstStocktake, addItemWithQty, completeStocktake, inviteAndJoinStaff, apiGet } from './helpers.js'
import { openStockTab, openItemSheet, closeItemSheet, padMove, stockCell } from './stockHelpers.js'

test('スタッフを招待して承認すると、2台がルームなしで同じ在庫になり、スタッフには店の削除が出ない', async ({ browser }) => {
  const ownerCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  acceptDialogs(owner)
  const code = await registerStore(owner)
  await startFirstStocktake(owner)
  await addItemWithQty(owner, 'トマト', 7)
  await completeStocktake(owner)

  const { ctx: staffCtx, page: staff } = await inviteAndJoinStaff(browser, owner, '鈴木')

  // スタッフの端末（localStorage 空から入った）に、オーナーの棚卸の数がサーバーから届く
  await openStockTab(staff)
  await expect(stockCell(staff, 'トマト')).toContainText('7')

  // スタッフが入庫 3 → オーナーの端末で在庫タブを開くと 10（読み込み直しなし）。
  // 記録の「誰が」はスタッフ本人。
  // 2026-11-28: 以前はログイン済みの端末が起動時・在庫タブで入出庫を読み直さず、ログインし直すまで 7 のままだった
  await openItemSheet(staff, 'トマト')
  await padMove(staff, 'in', 3)
  await staff.locator('.is-reg').click()
  await expect(staff.locator('.is-val')).toHaveText(/^\s*10/)
  await closeItemSheet(staff)
  await openStockTab(owner)
  await expect(stockCell(owner, 'トマト')).toContainText('10')
  // オーナーが在庫タブにいる間にスタッフがもう 2 入れる → オーナーが起動し直すと 12（起動時に読み直す）
  await openItemSheet(staff, 'トマト')
  await padMove(staff, 'in', 2)
  await staff.locator('.is-reg').click()
  await expect(staff.locator('.is-val')).toHaveText(/^\s*12/)
  await closeItemSheet(staff)
  await owner.reload()
  await expect(stockCell(owner, 'トマト')).toContainText('12')
  const moves = await apiGet(owner, `/store/${code}/movements`)
  expect(moves.status).toBe(200)   // スタッフがログインしても、オーナーのトークンは切れていない
  expect(JSON.stringify(moves.body)).toContain('鈴木')

  // スタッフ（アルバイトの既定＝在庫管理・タスク管理）: レポートとスタッフ管理の入口が無く、設定に店の削除が出ない
  await staff.getByText('ホーム', { exact: true }).last().click()
  await expect(staff.getByText('レポート', { exact: true })).toHaveCount(0)
  await expect(staff.getByText('スタッフ', { exact: true })).toHaveCount(0)
  await staff.getByText('設定', { exact: true }).first().click()
  await expect(staff.getByText('アカウントの削除')).toHaveCount(0)

  await staffCtx.close()
  await ownerCtx.close()
})
