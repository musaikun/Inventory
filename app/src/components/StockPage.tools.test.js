// 在庫タブの絞り込み（要補充・要確認・非表示）と並び替えのおすすめ（User決定 2026-10-03）。
// 管理タブの「整える・確認」をここへ移した。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: '', WS_BASE: '',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null, host = null, cfg = null

const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await tick() }
const btn = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
const chip = label => [...host.querySelectorAll('.sp-chip')].find(b => b.textContent.trim().startsWith(label))
const rowNames = () => [...host.querySelectorAll('.item-row')].map(r => r.dataset.item)

async function mountPage() {
  const { default: Page } = await import('./StockPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Page, { embedded: true }) })
  app.mount(host)
  await tick()
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

describe('要補充', () => {
  it('発注点が1つも無ければチップを出さない', async () => {
    await mountPage()
    expect(chip('すべて')).toBeTruthy()
    expect(chip('要補充')).toBeUndefined()
  })

  it('発注点を入れた品目だけを数え、件数を出す（発注点の無い品目は見込み0でも数えない）', async () => {
    const { useMovements } = await import('../composables/useMovements.js')
    useMovements().saveMovement({ type: 'in', lines: [{ item: 'トマト', qty: 2, unit: '個' }] })
    cfg.setReorderPoint('トマト', 3)
    await mountPage()
    expect(chip('要補充').textContent).toContain('1')
    await click(chip('要補充'))
    expect(rowNames()).toEqual(['トマト'])
    expect(host.textContent).toContain('発注点を設定した 1品目のうち')
  })
})

describe('要確認', () => {
  it('空欄のある品目数（非表示は除く）を出し、絞ると理由が見える', async () => {
    await mountPage()
    expect(chip('要確認').textContent).toContain('1')
    await click(chip('要確認'))
    expect(rowNames()).toEqual(['塩'])
    expect(host.querySelector('.sp-cell-why').textContent).toContain('単位なし')
  })

  it('「まとめて直す」で点検のページが開き、埋めると一覧から消える', async () => {
    await mountPage()
    await click(chip('要確認'))
    await click(btn(host, 'まとめて直す'))
    const page = host.querySelector('.ic-page')
    await click(page.querySelector('.ic-row-head'))
    const inputs = page.querySelectorAll('.ic-input')
    await type(inputs[0], 'kg')
    await type(inputs[1], '1')
    await type(inputs[2], '300')
    await type(inputs[3], '調味料')
    await click(btn(page, '保存'))
    expect(cfg.config.units['塩']).toBe('kg')
    expect(page.textContent).toContain('空欄のある品目はありません')
    expect(chip('要確認').textContent).toContain('0')
  })

  it('しばらく数えていない品目は、点検のページでその場で非表示にできる', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const s = (id, date, saltQty) => ({
      sessionId: id, date, savedAt: `${date}T01:00:00Z`,
      items: [{ item: 'トマト', qty: 5, unit: '個', unitPrice: 100, subtotal: 500 }, { item: '塩', qty: saltQty, unit: '', unitPrice: 0, subtotal: 0 }],
    })
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      s1: s('s1', '2026-08-01', 2), s2: s('s2', '2026-08-08', null), s3: s('s3', '2026-08-15', null), s4: s('s4', '2026-08-22', null),
    }))
    cfg.patchItem('塩', { unit: 'kg', lotSize: '1', price: 300, category: '調味料' })
    await mountPage()
    await click(chip('要確認'))
    expect(host.querySelector('.sp-cell-why').textContent).toContain('しばらく数えていない')
    await click(btn(host, 'まとめて直す'))
    const row = host.querySelector('.ic-page .ic-row')
    await click(row.querySelector('.ic-row-head'))
    expect(row.textContent).toContain('最後に数えたのは 8/1')
    await click(btn(row, '非表示にする'))
    expect(cfg.config.hiddenItems).toContain('塩')
  })
})

describe('非表示', () => {
  it('非表示の品目を並べ、その場で戻せる', async () => {
    await mountPage()
    expect(chip('非表示').textContent).toContain('1')
    await click(chip('非表示'))
    const row = host.querySelector('.hl-row')
    expect(row.textContent).toContain('なす')
    await click(btn(row, '戻す'))
    expect(cfg.config.hiddenItems).not.toContain('なす')
  })

  it('取込で除外した行は最後の入口から開いて品目にできる。登録済みの名前はボタンを出さない', async () => {
    cfg.loadFromCSV('品目名,単位\nキャベツ,玉\n小計,\nキャベツ,玉')
    await mountPage()
    await click(chip('非表示'))
    await click(host.querySelector('.hl-excl'))
    const rowOf = n => [...host.querySelectorAll('.hl-excl-body .hl-row')].find(r => r.querySelector('.hl-name').textContent === n)
    expect(rowOf('キャベツ').textContent).toContain('登録済み')
    await click(btn(rowOf('小計'), '品目にする'))
    expect(cfg.config.order).toContain('小計')
    expect(cfg.config.importExcluded.total).toBe(1)
    expect(host.textContent).toContain('「小計」を品目にしました')
  })

  it('全品目を削除すると除外の記録も消える', async () => {
    cfg.loadFromCSV('品目名,単位\n小計,\nキャベツ,玉')
    cfg.setEmptyList()
    expect(cfg.config.importExcluded).toBeNull()
  })
})

describe('並び替えのおすすめ', () => {
  const card = () => host.querySelector('.sr')

  it('並び替えが1つも無い店では、動きのあるカードを出す', async () => {
    await mountPage()
    expect(card().classList.contains('anim')).toBe(true)
    expect(card().textContent).toContain('並び替えを始める')
  })

  it('途中まで振り分けた店では、進み具合を出す。全部振り分けたら出さない', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.setItemTag('トマト', 0, '冷蔵庫')
    await mountPage()
    expect(card().classList.contains('anim')).toBe(false)
    expect(card().textContent).toContain('保管場所の振り分け 1 / 2')
    cfg.setItemTag('塩', 0, '棚')
    await tick()
    expect(card()).toBeNull()
  })

  it('「あとで」は3日後にまた出し、✕ は二度と出さない（端末に覚える）', async () => {
    const hints = await import('../composables/useHints.js')
    await mountPage()
    await click(btn(card(), 'あとで'))
    expect(card()).toBeNull()
    expect(hints.isHintShown('reco-sort', Date.now() + 2 * 86400000)).toBe(false)
    expect(hints.isHintShown('reco-sort', Date.now() + 4 * 86400000)).toBe(true)
    hints.restoreHints()
    await tick()
    await click(card().querySelector('.sr-x'))
    expect(card()).toBeNull()
    expect(hints.isHintShown('reco-sort', Date.now() + 365 * 86400000)).toBe(false)
    expect(hints.hiddenHintCount.value).toBe(1)
  })

  it('「並び替えを始める」で名前を決めて振り分けのページを開く', async () => {
    const menu = await import('../composables/appMenuState.js')
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('保管場所')
    await mountPage()
    await click(btn(card(), '並び替えを始める'))
    expect(cfg.config.axisNames[0]).toBe('保管場所')
    expect(menu.showAxisAssign.value).toBe(true)
    expect(menu.axisAssignInitial.value).toBe(0)
    prompt.mockRestore()
  })
})

describe('操作の説明', () => {
  it('✕ で消すと、その端末では出さない。各種設定から戻せる', async () => {
    const hints = await import('../composables/useHints.js')
    await mountPage()
    expect(host.textContent).toContain('今の見込み')
    await click(host.querySelector('.sp-hint .dh-x'))
    expect(host.textContent).not.toContain('今の見込み')
    hints.restoreHints()
    await tick()
    expect(host.textContent).toContain('今の見込み')
  })
})
