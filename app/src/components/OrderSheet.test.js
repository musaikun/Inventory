// 発注の1品目（User決定 2026-10-17）: 先に打って、何の数かは後で選ぶ
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, events
const tick = async () => { for (let i = 0; i < 5; i++) await nextTick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
const press = async label => { btn(label).click(); await tick() }
async function type(digits) { for (const d of String(digits)) { [...host.querySelectorAll('.numpad button')].find(b => b.textContent.trim() === d).click(); await tick() } }
async function mount(props = {}) {
  localStorage.setItem('_hints_v1', JSON.stringify({ hidden: ['coach-order-type-first'], until: {} }))
  ;(await import('../composables/useHints.js'))._reloadHints()
  const { default: C } = await import('./OrderSheet.vue')
  events = { confirm: [], cancel: 0, navigate: [] }
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(C, {
    ingredient: 'キャベツ', unit: '玉', orderLot: 1, today: '2026-10-20',
    orders: [{ date: '2026-10-13', lines: [{ item: 'キャベツ', qty: 2 }] }],
    onConfirm: p => events.confirm.push(p), onCancel: () => events.cancel++, onNavigate: p => events.navigate.push(p),
    ...props,
  }) })
  app.mount(host); await tick()
}
beforeEach(() => localStorage.clear())
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('発注：先に打って、何の数かは後で選ぶ', () => {
  it('トグルは無い。打つまで発注・在庫は押せず、打つと「発注 3玉」「在庫 3玉」になる', async () => {
    await mount()
    expect(host.querySelector('.basis-toggle')).toBeNull()
    expect(btn('発注').disabled).toBe(true)
    expect(btn('在庫').disabled).toBe(true)
    await type(3)
    expect(btn('発注 3玉')).toBeTruthy()
    expect(btn('在庫 3玉')).toBeTruthy()
  })

  it('発注数が分かる品目: 打つ → 発注（在庫は送らない）', async () => {
    await mount()
    await type(3)
    await press('発注 3玉')
    expect(events.confirm).toEqual([{ ingredient: 'キャベツ', orderMode: true, stock: null, orderQty: 3, stockOnly: false, unit: '玉', lot: 1 }])
  })

  it('迷う品目: 在庫 → 発注はいくつ？（参考の数は押すと入る。自動では入れない）→ 発注', async () => {
    await mount({ target: { value: 8, source: 'manual' } })
    await type(5)
    await press('在庫 5玉')
    expect(host.querySelector('.os-step').textContent).toContain('在庫 5玉 → 発注はいくつ？')
    expect(host.querySelector('.os-disp').textContent.trim()).toBe('発注数を打つ')
    expect([...host.querySelectorAll('.os-ref')].map(b => b.textContent)).toEqual(['推奨 3玉目標 8 − 在庫 5', '前回 2玉10/13'])
    await press('推奨 3')
    await press('発注 3玉')
    expect(events.confirm[0]).toMatchObject({ stock: 5, orderQty: 3, stockOnly: false })
  })

  it('在庫のあと「発注なし」「発注はあとで」', async () => {
    await mount()
    await type(5); await press('在庫 5玉'); await press('発注なし')
    expect(events.confirm[0]).toMatchObject({ stock: 5, orderQty: 0, stockOnly: false })
    app.unmount(); host.remove()
    await mount()
    await type(5); await press('在庫 5玉'); await press('発注はあとで')
    expect(events.confirm[0]).toMatchObject({ stock: 5, orderQty: 0, stockOnly: true })
  })

  it('何も打たずに「発注なしで確定」（1手）', async () => {
    await mount()
    await press('発注なしで確定')
    expect(events.confirm[0]).toMatchObject({ stock: null, orderQty: 0, stockOnly: false })
  })

  it('いつもと桁が違えば1回だけ訊く', async () => {
    const orders = ['2026-09-29', '2026-10-06', '2026-10-13'].map(date => ({ date, lines: [{ item: 'キャベツ', qty: 2 }] }))
    await mount({ orders })
    await type(9); await press('発注 9玉')
    expect(events.confirm).toHaveLength(0)
    expect(host.querySelector('.os-warn').textContent).toContain('いつもの2玉')
    await press('9玉で発注')
    expect(events.confirm[0]).toMatchObject({ orderQty: 9 })
  })

  it('小数は在庫にはできるが発注にはできない。打ちかけで次へ移ると何も残さない', async () => {
    await mount()
    host.querySelectorAll('.numpad button').forEach(b => { if (b.textContent.trim() === '.') b.click() })
    await tick(); await type(5)
    expect(btn('発注 0.5玉').disabled).toBe(true)
    expect(btn('在庫 0.5玉').disabled).toBe(false)
    app.unmount(); host.remove()
    await mount({ canNext: true })
    await type(3)
    host.querySelector('.os-nav[aria-label="次の品目"]').click(); await tick()
    expect(events.navigate).toEqual([{ dir: 'next', skip: true }])
    expect(events.confirm).toHaveLength(0)
  })

  it('初めてのときはお手本が出て、「やってみる」で閉じると次から出ない。「？」で見直せる', async () => {
    localStorage.clear()
    const { _reloadHints } = await import('../composables/useHints.js')
    _reloadHints()
    const { default: C } = await import('./OrderSheet.vue')
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp({ render: () => h(C, { ingredient: 'キャベツ', today: '2026-10-20' }) })
    app.mount(host); await tick()
    expect(host.querySelector('.cd')).not.toBeNull()
    await press('やってみる')
    expect(host.querySelector('.cd')).toBeNull()
    await press('？')
    expect(host.querySelector('.cd')).not.toBeNull()
  })
})
