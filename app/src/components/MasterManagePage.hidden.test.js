// データ管理の「非表示中」。誤って隠した品目を探して戻す場所なので、
// 最後に隠したものが先頭に来て、隠した時刻が読めることを固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: '', WS_BASE: '',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null
let host = null
let cfg = null

async function mountPage() {
  const { default: Page } = await import('./MasterManagePage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Page)
  app.mount(host)
  await nextTick()
  // 「非表示中 ▼ N件」を開く
  const head = [...host.querySelectorAll('.mm-block-head')].find(b => b.textContent.includes('非表示中'))
  head.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  return host
}

const rows  = () => [...host.querySelectorAll('.mm-hidden-row')]
const names = () => rows().map(r => r.querySelector('.mm-hidden-name').textContent.trim())

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  for (const n of ['トマト', 'レタス', 'なす']) cfg.addItem(n, 100, '野菜', '個')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('MasterManagePage — 非表示中の一覧', () => {
  it('最後に隠した品目が先頭に並び、時刻が出る', async () => {
    cfg.hideItem('トマト')
    cfg.config.hiddenAt['トマト'] = '2026-09-05T10:00:00.000Z'
    cfg.hideItem('レタス')   // 時刻は「いま」

    await mountPage()

    expect(names()).toEqual(['レタス', 'トマト'])
    expect(rows()[0].querySelector('.mm-hidden-at').textContent).toMatch(/^今日 /)
    expect(rows()[1].querySelector('.mm-hidden-at').textContent).toMatch(/^\d/)   // 9/5 …
  })

  it('戻すと一覧から消える', async () => {
    cfg.hideItem('トマト')
    await mountPage()
    expect(names()).toEqual(['トマト'])

    host.querySelector('.mm-restore').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(cfg.config.hiddenItems).not.toContain('トマト')
    expect(rows()).toHaveLength(0)
  })
})
