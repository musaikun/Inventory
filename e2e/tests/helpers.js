// 画面操作の共通手順。文言で探す（ユーザーが見ているものと同じ物を押す）。
import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

// playwright は e2e/ で起動する（npx playwright test・CI も working-directory: e2e）。
// このファイルは CommonJS に変換されるので import.meta は使えない
const E2E_DIR = process.cwd()

/**
 * 新規登録の回数制限（IP あたり1時間5回・SEC-005）を、E2E のローカル D1 でだけ戻す。
 * 1回の実行で店舗を5つより多く作るため。start-worker.sh と同じ D1（e2e/.state）を wrangler で直接触る。
 * 本番・preview の D1 には触れない（--local のみ）。
 */
export function resetRegisterLimit() {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'inventory-store', '--local',
    '--persist-to', process.env.E2E_STATE_DIR || path.join(E2E_DIR, '.state'),
    '--command', "DELETE FROM ip_attempts WHERE kind = 'register'"],
  { cwd: path.join(E2E_DIR, '..', 'worker'), stdio: 'ignore' })
}

export const PIN = '583920'   // オーナーの暗証番号は6桁（D-036）

/** confirm() は自動で OK。出た文言は記録して、テストから確かめられるようにする */
export function acceptDialogs(page) {
  const seen = []
  page.on('dialog', (d) => { seen.push(d.message()); d.accept() })
  return seen
}

/** 新規登録して店舗コードを返す。終わるとホーム */
export async function registerStore(page, storeName = 'E2E店') {
  resetRegisterLimit()
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
  // 確認はアプリの中のシートで訊く（0.209.0。以前はブラウザ標準の confirm）
  await expect(page.getByText('棚卸を完了しますか？')).toBeVisible()
  await page.getByRole('button', { name: '完了する', exact: true }).click()
  await expect(page.getByText('棚卸を完了しました ✓')).toBeVisible()
  // 終えた直後にまとめが出る（0.206.0）。閉じてホームへ
  await expect(page.getByText('棚卸が終わりました')).toBeVisible()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
}

/** 棚卸中のホストがルームを作り、招待リンク（パス以降）を返す。終わると棚卸画面に戻る */
export async function openRoom(host) {
  await host.getByTitle('ルームを作成して、スタッフのスマホをつなぐ').click()
  const link = (await host.getByText(/\?store=[A-Z0-9]+&s=/).innerText()).trim()
  await host.getByText('棚卸に戻る').click()
  return link.replace(/^https?:\/\/[^/?]+/, '')
}

/** 招待リンクから、ログインしていない端末がゲストとして参加する。使い方の案内は閉じる。
 *  setup(ctx) はページを開く前に呼ぶ（WebSocket の中継を仕込むなど） */
export async function joinAsGuest(browser, invitePath, name, { setup } = {}) {
  const ctx = await browser.newContext()
  if (setup) await setup(ctx)
  const page = await ctx.newPage()
  acceptDialogs(page)
  await page.goto(invitePath)
  await expect(page.getByText('参加者の名前を入力してください')).toBeVisible()
  await page.getByPlaceholder(/./).last().fill(name)
  await page.getByRole('button', { name: '参加する' }).click()
  await expect(page.getByText(/ルーム [A-Z0-9]+ に参加しました/)).toBeVisible()
  const intro = page.getByRole('button', { name: 'はじめる' })
  if (await intro.isVisible().catch(() => false)) await intro.click()
  return { ctx, page }
}

/** 一覧の品目の行（数量の列）。行の名前は「なす 編集 削除 5」の形なので先頭の品目名で探す
 *  （ホストの画面は品目名が独立した要素でなく、getByText の完全一致では拾えない） */
export function qtyCell(page, item) {
  const esc = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return page.getByRole('row', { name: new RegExp(`^${esc}(\\s|$)`) }).getByRole('cell').last()
}

/** 一覧から品目を開き、テンキーで数を打って確定する。数が入っている品目は「上書き」、まだの品目は「確定」 */
export async function overwriteQty(page, item, qty) {
  await qtyCell(page, item).click()
  for (const ch of String(qty)) {
    await page.getByRole('button', { name: ch, exact: true }).click()
  }
  const over = page.getByRole('button', { name: /上書き/ })
  if (await over.isVisible().catch(() => false)) await over.click()
  else await page.getByRole('button', { name: '確定', exact: true }).click()
  await expect(qtyCell(page, item)).toHaveText(new RegExp(`^\\s*${qty}\\b`))
}

/**
 * ルームの WebSocket を中継して、テストから本当に切れるようにする。
 * Chromium の setOffline は張ってある WebSocket を切らない（送ったものはブラウザ内で止まり、戻ると届く）ため、
 * それだけでは再接続の経路を通らない。cut() で今の接続を閉じ、restore() まで新しい接続も閉じる。
 */
export async function controllableRoomSocket(ctx) {
  let blocked = false
  let opened = 0
  const live = new Set()
  await ctx.routeWebSocket(/\/room\/[A-Z0-9]+\/ws/, (ws) => {
    if (blocked) { ws.close(); return }
    opened++
    ws.connectToServer()
    live.add(ws)
    ws.onClose(() => live.delete(ws))
  })
  return {
    get opened() { return opened },
    async cut() {
      blocked = true
      await ctx.setOffline(true)
      for (const ws of [...live]) await ws.close()
    },
    async restore() {
      blocked = false
      await ctx.setOffline(false)
    },
  }
}

/** ローカル Worker の API を、その端末のトークンで直接読む（画面に出ない保存先＝D1 を確かめる） */
export async function apiGet(page, apiPath, { token: given } = {}) {
  const port = Number(process.env.E2E_WORKER_PORT || 8787)
  return page.evaluate(async ({ url, given }) => {
    const token = given ?? localStorage.getItem('_auth_token')
    const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { url: `http://127.0.0.1:${port}${apiPath}`, given: given ?? null })
}

/** ホーム（棚卸の外）から、今日2回目の棚卸を「別の棚卸」として始める */
export async function startAnotherStocktakeToday(page) {
  await page.getByText('棚卸', { exact: true }).first().click()
  await page.getByText('ひとりで始める').click()
  await expect(page.getByText('今日はもう棚卸をしています')).toBeVisible()
  await page.getByText('別の棚卸として新しく始める').click()
}
