// 在庫タブ上部の「並び替え」カード（User決定 2026-10-10）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, cfg = null
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
async function mountCard() {
  const { default: Card } = await import('./SortCard.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(Card); app.mount(host); await tick()
  return host.querySelector('.sc')
}
beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig(); cfg.setEmptyList()
  cfg.addItem('トマト', 0, '野菜', '個'); cfg.addItem('塩', 0, '調味料', 'kg')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.restoreAllMocks() })

describe('並び替えカード', () => {
  it('まだ振り分けていない店では「おすすめ」で光り、中で小さく動く。押すと保管場所を作って開く', async () => {
    const menu = await import('../composables/appMenuState.js')
    const c = await mountCard()
    expect(c.classList.contains('hot')).toBe(true)
    expect(c.textContent).toContain('おすすめ')
    expect(c.querySelectorAll('.sc-demo i').length).toBe(9)
    await click(c.querySelector('.sc-go'))
    expect(cfg.config.axisNames[0]).toBe('保管場所')
    expect(menu.showAxisAssign.value).toBe(true)
    expect(menu.axisAssignInitial.value).toBe(0)
  })

  it('分け方ごとのボタンに進み具合。押すとその分け方を開く。空きがあれば＋', async () => {
    const menu = await import('../composables/appMenuState.js')
    cfg.setAxisName(0, '保管場所'); cfg.setItemTag('トマト', 0, '冷蔵庫')
    cfg.setAxisName(1, '仕入先'); cfg.setItemTag('トマト', 1, 'A社'); cfg.setItemTag('塩', 1, 'B社')
    const c = await mountCard()
    expect(c.classList.contains('hot')).toBe(false)
    const axes = [...c.querySelectorAll('.sc-ax')]
    expect(axes.map(a => a.textContent)).toEqual([expect.stringContaining('1 / 2 品目'), expect.stringContaining('✓ 振り分け済み')])
    expect(c.querySelector('.sc-ax.add')).toBeNull()
    await click(axes[1])
    expect(menu.axisAssignInitial.value).toBe(1)
    expect(menu.showAxisAssign.value).toBe(true)
  })

  it('1つだけなら「＋ 分け方を追加」で名前を訊いて2つ目を作る', async () => {
    const menu = await import('../composables/appMenuState.js')
    cfg.setAxisName(0, '保管場所'); cfg.setItemTag('トマト', 0, '冷蔵庫')
    vi.spyOn(window, 'prompt').mockReturnValue('仕入先')
    const c = await mountCard()
    await click(c.querySelector('.sc-ax.add'))
    expect(cfg.config.axisNames[1]).toBe('仕入先')
    expect(menu.axisAssignInitial.value).toBe(1)
  })
})
