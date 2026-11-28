// 品目の統合と、在庫タブからの名前の変更（ITEM-001 I-5・モック https://claude.ai/artifact/TARkmMdMB8v7Ucxut732oq）
import { test, expect } from '@playwright/test'
import { acceptDialogs, registerStore, login, startFirstStocktake, addItemWithQty, completeStocktake } from './helpers.js'
import { openStockTab, openItemSheet, closeItemSheet, padMove, stockCell, stockRow } from './stockHelpers.js'

test('重複かも → まとめると在庫が合わさり、元に戻すと分かれる。別の端末でも合わさる', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  acceptDialogs(a)
  const code = await registerStore(a)
  await startFirstStocktake(a)
  await addItemWithQty(a, 'トマト', 7)
  await completeStocktake(a)
  await openStockTab(a)
  // 棚卸の中で「とまと」と打つと「トマト」が出る（音声の辞書と同じ寄せ方）。重複は在庫タブの追加で作る
  await a.locator('.sp-fab').click()
  await a.locator('#if-name').fill('とまと')
  await a.getByRole('button', { name: '追加して次へ' }).click()
  await a.getByRole('button', { name: '完了', exact: true }).click()
  await openItemSheet(a, 'とまと')
  await padMove(a, 'in', 2)
  await a.locator('.is-reg').click()
  await closeItemSheet(a)

  await a.getByRole('button', { name: /^重複かも/ }).click()
  const grp = a.locator('.dup-grp').first()
  await expect(grp).toContainText('名前と単位が同じ')
  await grp.getByRole('button', { name: 'まとめる' }).click()
  await expect(a.locator('.dup-sum')).toContainText('9')
  await a.locator('.dup-acts').getByRole('button', { name: 'まとめる' }).click()
  await expect(a.locator('.sp-merge-toast')).toContainText('にまとめました')
  await expect(stockCell(a, 'トマト')).toContainText('9')
  await expect(stockRow(a, 'とまと')).toHaveCount(0)

  await a.locator('.sp-merge-toast').getByRole('button', { name: '元に戻す' }).click()
  await expect(stockCell(a, 'トマト')).toContainText('7')
  await expect(stockCell(a, 'とまと')).toContainText('2')

  // もう一度まとめて、別の端末で確かめる
  await a.getByRole('button', { name: /^重複かも/ }).click()
  await a.locator('.dup-grp').first().getByRole('button', { name: 'まとめる' }).click()
  await a.locator('.dup-acts').getByRole('button', { name: 'まとめる' }).click()
  await expect(stockCell(a, 'トマト')).toContainText('9')

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  acceptDialogs(b)
  await login(b, code)
  await openStockTab(b)
  await expect(stockCell(b, 'トマト')).toContainText('9')
  await expect(stockRow(b, 'とまと')).toHaveCount(0)
  await ctxA.close()
  await ctxB.close()
})

test('在庫タブの品目の情報から名前を変えられ、数はつながったまま', async ({ browser }) => {
  const ctx = await browser.newContext()
  const a = await ctx.newPage()
  acceptDialogs(a)
  await registerStore(a)
  await startFirstStocktake(a)
  await addItemWithQty(a, 'トマト', 7)
  await completeStocktake(a)
  await openStockTab(a)
  await openItemSheet(a, 'トマト')
  await a.getByRole('button', { name: '編集する' }).click()
  await a.locator('#if-name').fill('ミニトマト')
  await expect(a.getByText('名前を変えても、前の棚卸・入出庫・期限はこの品目の記録として続きます。')).toBeVisible()
  await a.getByRole('button', { name: '保存', exact: true }).click()
  await expect(stockCell(a, 'ミニトマト')).toContainText('7')
  await expect(stockRow(a, 'トマト')).toHaveCount(0)
  await ctx.close()
})
