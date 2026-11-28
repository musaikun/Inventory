// 在庫タブ・品目シートの操作（ITEM-001 の前に足した E2E 用）
import { expect } from '@playwright/test'

/** 下のメニューから在庫タブへ */
export async function openStockTab(page) {
  await page.getByText('在庫', { exact: true }).last().click()
  await expect(page.getByPlaceholder('品目名で絞り込み')).toBeVisible()
}

/** 在庫タブの品目の行（品目名の行） */
export function stockRow(page, item) {
  // 名前が一致する行だけ（「トマト」で「ミニトマト」の行を拾わない）
  return page.locator('tr').filter({ has: page.locator('.sp-cell') }).filter({ has: page.getByText(item, { exact: true }) }).first()
}

/** 在庫タブの数の欄 */
export function stockCell(page, item) {
  return stockRow(page, item).locator('.sp-cell')
}

/** 行を押して品目シートを開く */
export async function openItemSheet(page, item) {
  await stockRow(page, item).locator('td').first().click()
  await expect(page.locator('.is-sheet')).toBeVisible()
}

/** 品目シートの入庫（in）・出庫（out）にテンキーで数を入れる（まだ記録しない） */
export async function padMove(page, kind, qty) {
  await page.locator(kind === 'in' ? '#is-in' : '#is-out').click()
  const sheet = page.locator('.mq-sheet')
  for (const ch of String(qty)) await sheet.locator('.numpad-btn', { hasText: new RegExp(`^${ch}$`) }).click()
  await sheet.locator('.btn-primary').click()
  await expect(sheet).toHaveCount(0)
}

/** 品目シートを閉じる（右上の ✕） */
export async function closeItemSheet(page) {
  await page.locator('.is-sheet .is-x').click()
  await expect(page.locator('.is-sheet')).toHaveCount(0)
}
