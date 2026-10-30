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

  it('品目リスト整理: 導線がまだ無ければ「まだ」。押すと 導線作成／品目並び替え の2択で、導線作成から導線の振り分けへ（User決定 2026-10-30）', async () => {
    await seedItems(null)
    await mountTop()
    const c = card('品目リスト整理')
    expect(c.querySelector('.ht-bd').textContent).toBe('まだ')
    await click(c)
    expect(document.body.querySelector('.ht-sh').textContent).toContain('品目並び替え')
    const { showAxisAssign, axisAssignInitial, axisAssignUnassigned } = await import('../composables/appMenuState.js')
    await click(sheetBtn('導線作成'))
    expect(showAxisAssign.value).toBe(true)
    expect(axisAssignInitial.value).toBe(2)
    expect(axisAssignUnassigned.value).toBe(false)
  })

  it('品目リスト整理: 導線に入っていない品目があれば数を出し、押すとその品目だけで開く', async () => {
    await seedItems(null)
    const { useConfig, ROUTE } = await import('../composables/useConfig.js')
    const cfg = useConfig()
    cfg.addAxisGroup(ROUTE, '冷蔵庫')
    cfg.addItemToGroup(ROUTE, 'キャベツ', '冷蔵庫')
    await mountTop()
    expect(card('品目リスト整理').querySelector('.ht-bd').textContent).toBe('導線 3')
    await click(card('品目リスト整理'))
    await click(sheetBtn('導線に入っていない品目'))
    const { axisAssignInitial, axisAssignUnassigned } = await import('../composables/appMenuState.js')
    expect(axisAssignInitial.value).toBe(2)
    expect(axisAssignUnassigned.value).toBe(true)
    app.unmount(); host.remove()
    for (const n of ['トマト', '牛乳', '卵']) cfg.addItemToGroup(ROUTE, n, '冷蔵庫')
    await mountTop()
    expect(card('品目リスト整理').querySelector('.ht-bd'), '全部入っていれば印なし').toBeNull()
  })

  it('品目並び替え: 分類が無ければ説明と名前の入力 → ＋で分類を足して振り分けへ', async () => {
    await seedItems(null)
    await mountTop()
    await click(card('品目リスト整理'))
    await click(sheetBtn('品目並び替え'))
    const add = sheetBtn('＋ 分類を追加')
    expect(add.disabled).toBe(true)
    await click(sheetBtn('仕入先'))
    await click(add)
    const { useConfig } = await import('../composables/useConfig.js')
    expect(useConfig().config.axisNames[0]).toBe('仕入先')
    const { showAxisAssign, axisAssignInitial } = await import('../composables/appMenuState.js')
    expect(showAxisAssign.value).toBe(true)
    expect(axisAssignInitial.value).toBe(0)
  })

  it('並び替えに「保管場所」があって導線が無ければ、1回だけ導線にするか訊く', async () => {
    await seedItems(2)
    await mountTop()
    await click(card('品目リスト整理'))
    expect(document.body.querySelector('.ht-sh').textContent).toContain('「保管場所」は、棚卸で歩く順番ですか')
    await click(sheetBtn('導線にする'))
    const { useConfig } = await import('../composables/useConfig.js')
    const { config } = useConfig()
    expect(config.axisGroupsR, '一覧に無い割り当ても場所になる').toEqual(['冷蔵庫'])
    expect(config.tagsR['キャベツ']).toEqual(['冷蔵庫'])
    expect(config.axisNames[0]).toBe('')
    expect(document.body.querySelector('.ht-sh').textContent).toContain('導線作成')
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
