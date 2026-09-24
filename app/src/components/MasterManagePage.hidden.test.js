// データ管理の非表示の品目。設定済み品目一覧のタブ（非表示設定品目・非表示にした順）で見る。
// 誤って隠した品目を探して戻す場所なので、「非表示にした順」では最後に隠したものが先頭に来て、
// 隠した時刻が読めることを固定する。
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

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
const seg = label => [...host.querySelectorAll('.mm-page .seg-btn')].find(b => b.textContent.trim() === label)

async function mountPage() {
  const { default: Page } = await import('./MasterManagePage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Page)
  app.mount(host)
  await nextTick()
  await click(host.querySelector('.mm-listopen'))
  return host
}

const rows  = () => [...host.querySelectorAll('.mm-page .item-row')]
const names = () => rows().map(r => r.dataset.item)

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

describe('MasterManagePage — 非表示の品目（設定済み品目一覧のタブ）', () => {
  it('データ管理の画面に別の「非表示中」ブロックは無い', async () => {
    await mountPage()
    const titles = [...host.querySelectorAll('.mm-block-title')].map(e => e.textContent.trim())
    expect(titles).not.toContain('非表示中')
  })

  it('タブは ジャンル → 作ったグループ → 非表示設定品目 → 非表示にした順', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    const labels = [...host.querySelectorAll('.mm-page .seg-btn')].map(b => b.textContent.trim())
    expect(labels).toEqual(['ジャンル', '保管場所', '非表示設定品目', '非表示にした順'])
    expect(seg('ジャンル').classList.contains('active')).toBe(true)
  })

  it('非表示設定品目: 非表示の品目だけが、リストの順で出る', async () => {
    cfg.hideItem('なす')
    cfg.hideItem('トマト')
    await mountPage()
    await click(seg('非表示設定品目'))
    expect(names()).toEqual(['トマト', 'なす'])
  })

  it('非表示にした順: 最後に隠した品目が先頭に並び、時刻が出る', async () => {
    cfg.hideItem('トマト')
    cfg.config.hiddenAt['トマト'] = '2026-09-05T10:00:00.000Z'
    cfg.hideItem('レタス')   // 時刻は「いま」
    await mountPage()
    await click(seg('非表示にした順'))

    expect(names()).toEqual(['レタス', 'トマト'])
    expect(rows()[0].textContent).toMatch(/今日 \d+:\d{2} に非表示/)
    expect(rows()[1].textContent).toMatch(/9\/5 \d+:\d{2} に非表示/)
  })

  it('非表示の品目が無ければ言葉で出す', async () => {
    await mountPage()
    await click(seg('非表示にした順'))
    expect(rows()).toHaveLength(0)
    expect(host.querySelector('.mm-page').textContent).toContain('非表示の品目はありません')
  })

  it('ジャンルのタブでは非表示の品目も表から消えない（戻せなくなるため）', async () => {
    cfg.hideItem('トマト')
    await mountPage()
    expect(host.querySelector('.mm-page [data-item="トマト"]')).toBeTruthy()
  })
})
