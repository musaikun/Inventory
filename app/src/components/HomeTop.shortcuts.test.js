// ホームのショートカット（最大9枚・説明文なし・品目リスト整理とデータ。User決定 2026-10-26・名前は 2026-10-28）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), loadTasksFromD1: vi.fn(async () => []), loadHandoffsFromD1: vi.fn(async () => null) }))

let app = null, host = null, events = []
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const card = label => [...host.querySelectorAll('.ht-sc')].find(b => b.querySelector('b').textContent === label)
const sheetBtn = label => [...document.body.querySelectorAll('.ht-sh button')].find(b => b.textContent.includes(label))
async function mountTop(props = {}) {
  const { default: HomeTop } = await import('./HomeTop.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(HomeTop, { onGo: k => events.push(k), ...props }) }); app.mount(host); await tick()
}
async function seedItems(tagged) {
  const { useConfig } = await import('../composables/useConfig.js')
  const { config, setAxisName } = useConfig()
  config.order = ['キャベツ', 'トマト', '牛乳', '卵']
  if (tagged != null) {
    setAxisName(0, '保管場所')
    config.tagsA = Object.fromEntries(config.order.slice(0, tagged).map(n => [n, ['冷蔵庫']]))
  }
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); events = [] })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })

describe('ホームのショートカット', () => {
  it('説明文を出さない。取り込む・書き出すは「データ」1枚で、押すと2択', async () => {
    await seedItems(null)
    await mountTop()
    expect(host.querySelector('.ht-sc small')).toBeNull()
    expect(card('取り込む')).toBeUndefined()
    await click(card('データ'))
    await click(sheetBtn('書き出す'))
    expect(events).toEqual(['export'])
    expect(document.body.querySelector('.ht-sh')).toBeNull()
  })

  it('品目リスト整理: 振り分けの途中は「あと N」で光る。押すと分け方の一覧から振り分けの画面へ', async () => {
    await seedItems(1)
    await mountTop()
    const c = card('品目リスト整理')
    expect(c.querySelector('.ht-bd').textContent).toBe('あと3')
    expect(c.classList.contains('hot')).toBe(false)   // 光らせない（棚卸の中断中と紛れる・User決定 2026-10-27）
    await click(c)
    expect(document.body.querySelector('.ht-sh').textContent).toContain('1 / 4 品目')
    const { showAxisAssign, axisAssignInitial } = await import('../composables/appMenuState.js')
    await click(sheetBtn('保管場所'))
    expect(showAxisAssign.value).toBe(true)
    expect(axisAssignInitial.value).toBe(0)
  })

  it('品目リスト整理: 分類がまだ無ければ、並び方の説明と名前の入力 → ＋で分類を足して振り分けへ（User決定 2026-10-28）', async () => {
    await seedItems(null)
    await mountTop()
    await click(card('品目リスト整理'))
    const sh = document.body.querySelector('.ht-sh')
    expect(sh.textContent).toContain('数える順に並べます')
    const add = sheetBtn('＋ 分類を追加')
    expect(add.disabled).toBe(true)
    await click(sheetBtn('仕入先'))
    expect(add.disabled).toBe(false)
    await click(add)
    const { useConfig } = await import('../composables/useConfig.js')
    expect(useConfig().config.axisNames[0]).toBe('仕入先')
    const { showAxisAssign, axisAssignInitial } = await import('../composables/appMenuState.js')
    expect(showAxisAssign.value).toBe(true)
    expect(axisAssignInitial.value).toBe(0)
    expect(document.body.querySelector('.ht-sh')).toBeNull()
  })

  it('品目リスト整理: 振り分け済みなら印なし', async () => {
    await seedItems(4)
    await mountTop()
    expect(card('品目リスト整理').querySelector('.ht-bd')).toBeNull()
    expect(card('品目リスト整理').classList.contains('hot')).toBe(false)
  })

  it('始まっている棚卸: だれかがルームにいれば「進行中」で輪が回る。いなければ「中断中」（User決定 2026-10-27）', async () => {
    const session = { id: 's1', type: 'stock', status: 'active', startedAt: new Date().toISOString() }
    await mountTop({ activeSession: session, live: { isActive: true, sessionId: 's1', participants: [{ name: '佐藤' }] } })
    expect(card('棚卸').querySelector('.ht-bd').textContent).toBe('進行中')
    expect(card('棚卸').querySelector('.ht-spin')).not.toBeNull()
    app.unmount(); host.remove()
    await mountTop({ activeSession: session, live: { isActive: true, sessionId: 's1', participants: [] } })
    expect(card('棚卸').querySelector('.ht-bd').textContent).toBe('中断中')
    expect(card('棚卸').querySelector('.ht-spin')).toBeNull()
    expect(card('棚卸').getAttribute('aria-label')).toBe('棚卸（中断中）を続ける')
  })
})
