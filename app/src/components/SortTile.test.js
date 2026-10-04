// ホームの「並び替え」タイル（棚卸・発注と並ぶ。User決定 2026-10-04）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, cfg = null
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
async function mountTile() {
  const { default: Tile } = await import('./SortTile.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(Tile); app.mount(host); await tick()
  return host.querySelector('.st')
}
beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig(); cfg.setEmptyList()
  cfg.addItem('トマト', 0, '野菜', '個'); cfg.addItem('塩', 0, '調味料', 'kg')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('並び替えタイル', () => {
  it('まだ振り分けていない店では「おすすめ」で光り、中で小さく動く', async () => {
    const t = await mountTile()
    expect(t.classList.contains('hot')).toBe(true)
    expect(t.textContent).toContain('おすすめ')
    expect(t.querySelectorAll('.st-mini i').length).toBe(9)
  })

  it('途中なら進み具合、振り分け済みなら名前だけ（光らない）', async () => {
    cfg.setAxisName(0, '保管場所'); cfg.setItemTag('トマト', 0, '冷蔵庫')
    const t = await mountTile()
    expect(t.classList.contains('hot')).toBe(false)
    expect(t.textContent).toContain('保管場所 1/2')
    cfg.setItemTag('塩', 0, '棚'); await tick()
    expect(t.querySelector('.st-sub').textContent).toBe('保管場所')
  })

  it('押すと振り分けの画面を開く（名前が無ければ決めてから）', async () => {
    const menu = await import('../composables/appMenuState.js')
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('保管場所')
    const t = await mountTile()
    t.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(cfg.config.axisNames[0]).toBe('保管場所')
    expect(menu.showAxisAssign.value).toBe(true)
    prompt.mockRestore()
  })
})
