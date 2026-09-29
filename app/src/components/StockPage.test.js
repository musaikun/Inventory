// 品目・在庫ページ：一覧に「＋」、1品目ずつ追加、行タップで品目シート → 情報を直す（User相談 2026-09-29）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null, host = null, cfg, events

async function mount() {
  const { default: Page } = await import('./StockPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  events = { openMaster: 0, startSession: 0 }
  app = createApp({ render: () => h(Page, {
    onOpenMaster: () => events.openMaster++, onStartSession: () => events.startSession++,
  }) })
  app.mount(host)
  for (let i = 0; i < 3; i++) await nextTick()
}
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input')); await tick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  await nextTick()
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('品目が0件', () => {
  it('一覧の代わりに登録の入口を出す（1つずつ・ファイル・棚卸しながら）', async () => {
    await mount()
    expect(host.textContent).toContain('最初の品目を追加')
    await click(btn('📄 ファイルからまとめて取込'))
    expect(events.openMaster).toBe(1)
    await click(btn('または、棚卸をしながら登録する'))
    expect(events.startSession).toBe(1)
    await click(btn('＋ 1つずつ追加'))
    expect(host.querySelector('[aria-label="品目を追加"][role="dialog"]')).not.toBeNull()
  })
})

describe('1品目ずつ追加', () => {
  beforeEach(() => { cfg.addItem('Pスライスベーコン', 420, '昼食材冷凍', 'p') })

  it('＋ → 名前だけで追加でき、名前だけ空になって続けて入れられる', async () => {
    await mount()
    await click(host.querySelector('.sp-fab'))
    await type(host.querySelector('#if-name'), 'トマト')
    await type(host.querySelector('#if-cat'), '野菜')
    await click(btn('追加して次へ'))
    expect(cfg.config.order).toContain('トマト')
    expect(cfg.config.categories['トマト']).toBe('野菜')
    expect(host.querySelector('#if-name').value).toBe('')
    expect(host.querySelector('#if-cat').value, 'ジャンルは続けて使う').toBe('野菜')
    expect(host.querySelector('.if-added').textContent).toContain('トマト')
  })

  it('似た名前があれば1回止め、もう一度押せば別の品目として追加する', async () => {
    await mount()
    await click(host.querySelector('.sp-fab'))
    await type(host.querySelector('#if-name'), 'ベーコン')
    expect(host.querySelector('.if-similar').textContent).toContain('Pスライスベーコン')
    await click(btn('追加して次へ'))
    expect(cfg.config.order).not.toContain('ベーコン')
    await click(btn('別の品目として追加'))
    expect(cfg.config.order).toContain('ベーコン')
  })

  it('登録済みの名前は追加できない', async () => {
    await mount()
    await click(host.querySelector('.sp-fab'))
    await type(host.querySelector('#if-name'), 'Pスライスベーコン')
    expect(host.textContent).toContain('その名前は既に登録されています')
    expect(btn('追加して次へ').disabled).toBe(true)
  })
})

describe('一覧と品目シート', () => {
  beforeEach(() => { cfg.addItem('Pスライスベーコン', 420, '昼食材冷凍', 'p') })

  it('数字は根拠つきの見込みで、ここでは書き換えない。行タップ → 情報を直す', async () => {
    await mount()
    const cell = host.querySelector('.sp-cell')
    expect(cell.textContent).toContain('棚卸なし')
    expect(host.querySelector('.sp-cell input'), '一覧に数の入力欄は無い').toBeNull()

    const row = [...host.querySelectorAll('tr')].find(tr => tr.textContent.includes('Pスライスベーコン') && tr.querySelector('.sp-cell'))
    await click(row.querySelector('td'))
    await click(btn('✏️ 品目の情報を直す'))
    const unit = host.querySelector('#if-unit')
    expect(unit.value).toBe('p')
    await type(unit, '袋')
    await click(btn('保存'))
    expect(cfg.config.units['Pスライスベーコン']).toBe('袋')
  })
})
