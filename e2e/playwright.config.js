// E2E: 実ブラウザ + ローカル Worker（Miniflare で DO・D1・R2 を模擬）。
// 単体テストでは拾えない「端末をまたぐ・D1 と localStorage の食い違い」型の不具合を見る
// （bug-reports.md の R-001 / F-001〜F-004 がこの型）。
// 起動のたびに D1 をまっさらにする（start-worker.sh）。登録は IP あたり 5 回までなので、
// 1 回の実行で店舗登録は 5 回以内に収める。
import { defineConfig, devices } from '@playwright/test'

const WORKER_PORT = Number(process.env.E2E_WORKER_PORT || 8787)
const APP_PORT = Number(process.env.E2E_APP_PORT || 4173)

// クラウド開発環境では Chromium が /opt/pw-browsers に入っている。CI では playwright install で入れる。
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './tests',
  // 店舗登録のレート制限と、同じ Worker を共有することから直列で回す
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    ...devices['Pixel 7'],
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: './scripts/start-worker.sh',
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: './scripts/start-app.sh',
      url: `http://127.0.0.1:${APP_PORT}/`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
})
