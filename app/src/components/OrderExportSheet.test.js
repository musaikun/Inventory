// 発注の書き出し（User決定 2026-10-07）。仕入先ごとに品目名と数量だけを出し、共有かコピーで送る。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, events
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick() }
const sheet = () => document.body.querySelector('.oe')
const btns = label => [...document.body.querySelectorAll('.oe button')].filter(b => b.textContent.trim() === label)

beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig(); cfg.setEmptyList()
  cfg.addItem('キャベツ', 0, '', '玉'); cfg.addItem('牛乳', 0, '', '本')
  cfg.setAxisName(0, '仕入先'); cfg.addAxisGroup(0, '八百屋'); cfg.addAxisGroup(0, '乳業')
  cfg.setItemTag('キャベツ', 0, '八百屋'); cfg.setItemTag('牛乳', 0, '乳業')
  const { default: Sheet } = await import('./OrderExportSheet.vue')
  events = []
  const host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(Sheet, {
    order: { date: '2026-10-07', lines: [{ item: '牛乳', qty: 6, unit: '本', lot: 1 }, { item: 'キャベツ', qty: 2, unit: '玉', lot: 1 }] },
    onClose: () => events.push('close'),
  }) })
  app.mount(host); await tick()
})
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('発注の書き出し', () => {
  it('仕入先ごとに品目名と数量だけを出す', () => {
    const groups = [...sheet().querySelectorAll('.oe-grp')]
    expect(groups.map(g => g.querySelector('b').textContent)).toEqual(['八百屋', '乳業'])
    expect(groups[0].querySelector('.oe-text').textContent).toBe('キャベツ　2玉')
    expect(sheet().textContent).toContain('10/7の発注')
  })

  it('コピーで仕入先の分だけを写す', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    btns('コピー')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(writeText).toHaveBeenCalledWith('牛乳　6本')
    expect(sheet().textContent).toContain('コピーしました')
  })
})
