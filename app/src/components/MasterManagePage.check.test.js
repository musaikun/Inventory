// 品目の点検（空欄のある品目を埋める）と、取込で除外した行を品目にする操作。
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

async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await nextTick() }
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
const btn = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))

async function mountPage() {
  const { default: Page } = await import('./MasterManagePage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Page)
  app.mount(host)
  await nextTick()
  return host
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 100, '野菜', '個')
  cfg.setItemExtras('トマト', { lotSize: '10個' })
  cfg.addItem('塩', 0, '', '')
  cfg.addItem('なす', 0, '', '')
  cfg.hideItem('なす')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('品目の点検', () => {
  it('カードに空欄のある品目数（非表示は除く）を出し、開くと空欄の種類が見える', async () => {
    await mountPage()
    const card = host.querySelector('.mm-checkopen')
    expect(card.textContent).toContain('1件')
    await click(card)
    const page = host.querySelector('.ic-page')
    const row = page.querySelector('.ic-row')
    expect(row.textContent).toContain('塩')
    expect([...row.querySelectorAll('.ic-tag')].map(t => t.textContent)).toEqual(['入数', '単位', '単価', 'ジャンル'])
    expect(btn(page, '入数なし').textContent).toContain('1')
  })

  it('行を開いて埋めると保存され、空欄が無くなれば一覧から消える', async () => {
    await mountPage()
    await click(host.querySelector('.mm-checkopen'))
    const page = host.querySelector('.ic-page')
    await click(page.querySelector('.ic-row-head'))
    const inputs = page.querySelectorAll('.ic-input')
    await type(inputs[0], 'kg')
    await type(inputs[1], '1')
    await type(inputs[2], '300')
    await type(inputs[3], '調味料')
    await click(btn(page, '保存'))
    expect(cfg.config.units['塩']).toBe('kg')
    expect(cfg.config.lotSizes['塩']).toBe('1')
    expect(cfg.config.prices['塩']).toBe(300)
    expect(cfg.config.categories['塩']).toBe('調味料')
    expect(page.querySelector('.ic-row')).toBeNull()
    expect(page.textContent).toContain('空欄のある品目はありません')
  })
})

describe('取込で除外した行を品目にする', () => {
  it('「品目にする」で追加され、除外の記録から外れる。登録済みの名前はボタンを出さない', async () => {
    cfg.loadFromCSV('品目名,単位\nキャベツ,玉\n小計,\nキャベツ,玉')
    await mountPage()
    await click(host.querySelector('.mm-listopen'))
    await click(host.querySelector('.mm-stat.excluded'))
    const rowOf = n => [...host.querySelectorAll('.mm-excluded-row')].find(r => r.querySelector('.mm-excluded-name').textContent === n)
    expect(rowOf('キャベツ').textContent).toContain('登録済み')
    await click(rowOf('小計').querySelector('.mm-excluded-adopt'))
    expect(cfg.config.order).toContain('小計')
    expect(cfg.config.importExcluded.total).toBe(1)
    expect(rowOf('小計')).toBeUndefined()
    expect(host.textContent).toContain('「小計」を品目にしました')
  })
})

describe('しばらく数えていない品目', () => {
  it('最後に数えた日を出し、その場で非表示にできる', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const s = (id, date, saltQty) => ({
      sessionId: id, date, savedAt: `${date}T01:00:00Z`,
      items: [{ item: 'トマト', qty: 5, unit: '個', unitPrice: 100, subtotal: 500 }, { item: '塩', qty: saltQty, unit: '', unitPrice: 0, subtotal: 0 }],
    })
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      s1: s('s1', '2026-08-01', 2), s2: s('s2', '2026-08-08', null), s3: s('s3', '2026-08-15', null), s4: s('s4', '2026-08-22', null),
    }))
    // トマトは全部埋まっているので、未計測だけで出るかを見るために塩も埋める
    cfg.patchItem('塩', { unit: 'kg', lotSize: '1', price: 300, category: '調味料' })
    await mountPage()
    await click(host.querySelector('.mm-checkopen'))
    const page = host.querySelector('.ic-page')
    expect(btn(page, 'しばらく数えていない').textContent).toContain('1')
    const row = page.querySelector('.ic-row')
    expect(row.textContent).toContain('塩')
    expect(row.textContent).toContain('未計測')
    await click(row.querySelector('.ic-row-head'))
    expect(row.textContent).toContain('最後に数えたのは 8/1')
    await click(btn(row, '非表示にする'))
    expect(cfg.config.hiddenItems).toContain('塩')
    expect(page.querySelector('.ic-row')).toBeNull()
  })
})
