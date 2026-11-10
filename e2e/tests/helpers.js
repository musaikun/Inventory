// 画面操作の共通手順。文言で探す（ユーザーが見ているものと同じ物を押す）。
import { expect } from '@playwright/test'

export const PIN = '583920'   // オーナーの暗証番号は6桁（D-036）

/** confirm() は自動で OK。出た文言は記録して、テストから確かめられるようにする */
export function acceptDialogs(page) {
  const seen = []
  page.on('dialog', (d) => { seen.push(d.message()); d.accept() })
  return seen
}

/** 新規登録して店舗コードを返す。終わるとホーム */
export async function registerStore(page, storeName = 'E2E店') {
  await page.goto('/')
  await page.getByText('ログイン・店舗の登録').click()
  await page.getByRole('button', { name: '新規登録' }).click()
  await page.getByPlaceholder('例：渋谷カフェ').fill(storeName)
  const pins = page.getByPlaceholder('●●●●●●', { exact: true })
  await pins.nth(0).fill(PIN)
  await pins.nth(1).fill(PIN)
  await page.getByRole('button', { name: '登録して店舗コードを発行' }).click()
  const code = (await page.locator('.shop-code-value').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{6,8}$/)
  await page.getByRole('button', { name: 'ホームへ進む' }).click()
  await expect(page.getByText(storeName)).toBeVisible()
  return code
}

/** 店舗コード + PIN でログイン（別端末を想定） */
export async function login(page, code, pin = PIN) {
  await page.goto('/')
  await page.getByText('ログイン・店舗の登録').click()
  await page.getByPlaceholder('例：ABCDEF').first().fill(code)
  await page.getByPlaceholder('●●●●●●', { exact: true }).first().fill(pin)
  await page.getByRole('button', { name: /ログイン/ }).last().click()
}

/** ホームから棚卸を始める（品目ゼロの店舗用） */
export async function startFirstStocktake(page) {
  await page.getByText('棚卸', { exact: true }).first().click()
  await page.getByText('数えながら登録して始める').click()
  await page.getByRole('button', { name: 'はじめる' }).click()
}

/** 棚卸画面で新しい品目を登録し、テンキーで数量を入れて確定する */
export async function addItemWithQty(page, name, qty) {
  const box = page.getByPlaceholder(/例：コーヒー/)
  await box.fill(name)
  await box.press('Enter')
  await page.getByRole('button', { name: '登録して数量へ' }).click()
  for (const ch of String(qty)) {
    await page.getByRole('button', { name: ch, exact: true }).click()
  }
  await page.getByRole('button', { name: '確定', exact: true }).click()
  await expect(page.getByText(`${name} を更新しました`)).toBeVisible()
}

export async function completeStocktake(page) {
  await page.getByRole('button', { name: /棚卸完了/ }).click()
  await expect(page.getByText('棚卸を完了しました ✓')).toBeVisible()
}
