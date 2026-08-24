// 全開閉の操作を、表ヘッダーの ▶/▼ に集約したことの回帰。
// 「全て開く」「すべて閉じる」の文字ボタンを2つ出す代わりに、グループ行と同じ記号で
// 状態も兼ねて示す。記号が状態と食い違うと、押した結果が予測できなくなる。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let cfg

async function mount(props = {}) {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Table, { inventory: {}, filledCount: 0, ...props }),
  })
  app.mount(host)
  await nextTick()
  return host
}

const headRow = () => host.querySelector('thead tr')
const arrow = () => host.querySelector('.th-arrow')?.textContent.trim()
const groupArrows = () => [...host.querySelectorAll('.cat-arrow')].map(e => e.textContent.trim())
async function clickHead() {
  headRow().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('InventoryTable — 全開閉', () => {
  it('文字ボタンを持たない', async () => {
    await mount()
    const labels = [...host.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels).not.toContain('全て開く')
    expect(labels).not.toContain('すべて閉じる')
  })

  it('ヘッダーの記号がグループの開閉状態を示す', async () => {
    await mount()
    expect(arrow()).toBe('▶')             // 既定は閉じている
    expect(groupArrows().every(a => a === '▶')).toBe(true)

    await clickHead()
    expect(arrow()).toBe('▼')
    expect(groupArrows().every(a => a === '▼')).toBe(true)   // 全グループが開く

    await clickHead()
    expect(arrow()).toBe('▶')
    expect(groupArrows().every(a => a === '▶')).toBe(true)   // 全グループが閉じる
  })

  it('支援技術にも開閉状態を伝える', async () => {
    await mount()
    expect(headRow().getAttribute('role')).toBe('button')
    expect(headRow().getAttribute('aria-expanded')).toBe('false')
    await clickHead()
    expect(headRow().getAttribute('aria-expanded')).toBe('true')
  })

  it('キーボードでも操作できる', async () => {
    await mount()
    headRow().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(arrow()).toBe('▼')
  })

  it('数量・金額の見出しは元の位置に残る', async () => {
    await mount()
    expect(host.querySelector('.th-qty').textContent).toContain('数量')
    // 単価があるので金額列も出る
    expect(host.querySelector('.th-amount')).not.toBeNull()
  })

  it('並べ替えを切り替えても、記号と実際の開閉が食い違わない', async () => {
    // 軸を用意して「ジャンル」以外の並べ替えを出す
    cfg.setAxisName(0, '保管場所')
    cfg.setItemTag('トマト', 0, '冷蔵')
    await mount()
    await clickHead()
    expect(arrow()).toBe('▼')

    const axisBtn = [...host.querySelectorAll('.seg-btn')].find(b => b.textContent.includes('保管場所'))
    axisBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    // 並べ替えごとに開閉を持つので、切り替えた直後は閉じた状態＝記号も ▶
    expect(arrow()).toBe('▶')
    expect(groupArrows().every(a => a === '▶')).toBe(true)
  })
})
