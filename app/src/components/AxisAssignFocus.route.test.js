// 棚卸の導線（並び替えとは別の枠・入れる｜順番・まだ他にある。User決定 2026-10-30）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg = null, ROUTE = 2
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = label => [...document.body.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
const row = name => [...host.querySelectorAll('.af-item')].find(r => r.querySelector('.af-item-name')?.textContent === name)

async function mount() {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Focus, { initialAxis: ROUTE }) })
  app.mount(host)
  await tick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const m = await import('../composables/useConfig.js')
  ROUTE = m.ROUTE
  cfg = m.useConfig()
  cfg.setEmptyList()
  for (const n of ['牛乳', 'バター', '米']) cfg.addItem(n, 0, '', '個')
  cfg.addAxisGroup(ROUTE, '冷蔵庫')
  cfg.addAxisGroup(ROUTE, '冷凍庫')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })

describe('導線の振り分け', () => {
  it('導線は紫・名前の編集なし。入れると番号が出て、1か所目は［他の場所にもある］を訊く', async () => {
    await mount()
    expect(host.querySelector('.af').classList.contains('route')).toBe(true)
    expect(host.querySelector('.af-title').textContent).toContain('導線')
    expect(host.querySelector('.af-title-edit')).toBeNull()
    await click(row('牛乳'))
    expect(cfg.config.tagsR['牛乳']).toEqual(['冷蔵庫'])
    expect(cfg.config.tagsA['牛乳']).toBeUndefined()
    expect(row('牛乳').querySelector('.af-check').textContent).toBe('1')
    expect(host.querySelector('.af-askbar').textContent).toContain('牛乳')
    await click(btn('他の場所にもある'))
    expect(cfg.config.routeMore).toEqual(['牛乳'])
  })

  it('「まだ」の品目は場所があっても未振り分けに残り、札で済みに戻せる', async () => {
    cfg.addItemToGroup(ROUTE, 'バター', '冷蔵庫')
    cfg.addItemToGroup(ROUTE, '牛乳', '冷蔵庫')
    cfg.setRouteMore('バター', true)
    await mount()
    expect(host.querySelector('.af-prog-more').textContent).toContain('1品目')
    await click(btn('未振り分けのみ'))
    const names = [...host.querySelectorAll('.af-item-name')].map(e => e.textContent)
    expect(names[0], '「まだ」は上へ').toBe('バター')
    expect(names).toContain('米')
    expect(names).not.toContain('牛乳')
    await click(row('バター').querySelector('.af-more-pill'))
    expect(cfg.config.routeMore).toEqual([])
    expect([...host.querySelectorAll('.af-item-name')].map(e => e.textContent)).not.toContain('バター')
  })

  it('「まだ」の品目を別の場所に入れたら［これで全部］で済みにできる', async () => {
    cfg.addItemToGroup(ROUTE, 'バター', '冷凍庫')
    cfg.setRouteMore('バター', true)
    await mount()
    await click(row('バター'))
    expect(cfg.config.tagsR['バター']).toEqual(['冷凍庫', '冷蔵庫'])
    expect(host.querySelector('.af-askbar').textContent).toContain('ほかの場所にもありますか')
    await click(btn('これで全部'))
    expect(cfg.config.routeMore).toEqual([])
  })

  it('順番: 押した順に番号が付き、確定すると場所の中の並びになる', async () => {
    for (const n of ['牛乳', 'バター', '米']) cfg.addItemToGroup(ROUTE, n, '冷蔵庫')
    await mount()
    await click(btn('順番'))
    const pick = n => [...host.querySelectorAll('.af-ord-pick')].find(b => b.textContent.includes(n))
    expect([...host.querySelectorAll('.af-ord-no')].map(e => e.textContent)).toEqual(['1', '2', '3'])
    await click(pick('米'))
    await click(pick('牛乳'))
    expect(pick('米').querySelector('.af-ord-no').textContent).toBe('1')
    expect(pick('バター').querySelector('.af-ord-no').textContent).toBe('–')
    await click(btn('確定'))
    expect(cfg.axisItemSequence(ROUTE).slice(0, 3)).toEqual(['米', '牛乳', 'バター'])
    expect(cfg.config.axisItemOrderA ?? []).toEqual([])
  })
})
