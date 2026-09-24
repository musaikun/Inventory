// 発注基準の設定シート。守る契約:
//   ・仮定が未設定なら最初に3問を出し、保存するまで config へ書かない
//   ・仮／実績／手動／未設定を見分けられる
//   ・数字を入れた品目だけが手動になり、「自動に戻す」で解除できる
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props = {}) {
  const { default: Modal } = await import('./OrderBaseModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { save: [], set: [] }
  app = createApp({
    render: () => h(Modal, {
      rows: [],
      unitOf: () => '個',
      intervalDays: 7,
      onSaveAssumptions: (v) => events.save.push(v),
      onSetReorder: (item, v) => events.set.push([item, v]),
      onClose: () => {},
      ...props,
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}
function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
}
async function click(el) { el.click(); await nextTick() }
const rowOf = (name) => [...host.querySelectorAll('.ob-row')].find(r => r.textContent.includes(name))

const rows = [
  { item: 'トマト', category: '野菜', reorder: { value: 16, source: 'assumed', basis: '仮: 在庫40 ÷ 5日分 × (届くまで1＋余裕1)日' }, target: { value: 72, source: 'assumed' } },
  { item: 'キャベツ', category: '野菜', reorder: { value: 6, source: 'consumption', basis: '推定消費 2.0/日 × 3日' }, target: null },
  { item: '牛肉', category: '肉', reorder: { value: 5, source: 'manual', basis: '手動で設定した発注点' }, target: { value: 10, source: 'reorder' } },
  { item: '塩', category: '', reorder: null, target: null },
]

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('OrderBaseModal', () => {
  it('仮定が未設定なら3問を出し、既定値で保存できる', async () => {
    const ev = await mount({ rows })
    expect(host.textContent).toContain('発注してから届くまで')
    expect(host.textContent).toContain('5日分')          // 週1・余裕1 → 5
    await click(button('2日'))                          // 届くまで2日（最初の「2日」）
    await click(button('この仮定で出す'))
    expect(ev.save).toEqual([{ leadDays: 2, safetyDays: 1, stockDays: null, stockDaysByCategory: {} }])
  })

  it('何日分を変えると、その値で保存する', async () => {
    const ev = await mount({ rows })
    await click(host.querySelector('.ob-step[aria-label="増やす"]'))
    await click(button('この仮定で出す'))
    expect(ev.save[0].stockDays).toBe(6)
  })

  it('ジャンル別の日数を保存できる', async () => {
    const ev = await mount({ rows })
    await click(button('▾ ジャンルごとに変える'))
    const input = host.querySelector('input[aria-label="野菜 の在庫日数"]')
    input.value = '3'; input.dispatchEvent(new Event('input')); await nextTick()
    await click(button('この仮定で出す'))
    expect(ev.save[0].stockDaysByCategory).toEqual({ 野菜: 3 })
  })

  it('仮定が保存済みなら要約を出し、仮／実績／手動／未設定を見分けられる', async () => {
    await mount({ rows, assumptions: { leadDays: 1, safetyDays: 1, stockDays: null, stockDaysByCategory: {} } })
    expect(host.textContent).toContain('届くまで1日・余裕1日・5日分')
    expect(rowOf('トマト').querySelector('.ob-badge').textContent).toBe('仮')
    expect(rowOf('キャベツ').querySelector('.ob-badge').textContent).toBe('実績')
    expect(rowOf('牛肉').querySelector('.ob-badge').textContent).toBe('手動')
    expect(rowOf('塩').querySelector('.ob-badge').textContent).toBe('未設定')
    // 仮・実績は入力欄を空にして目安を placeholder に出す（保存されていない値だと分かる）
    expect(rowOf('トマト').querySelector('.ob-input').value).toBe('')
    expect(rowOf('トマト').querySelector('.ob-input').getAttribute('placeholder')).toBe('16')
    expect(rowOf('牛肉').querySelector('.ob-input').value).toBe('5')
  })

  it('数字を入れると手動、「自動に戻す」で解除', async () => {
    const ev = await mount({ rows, assumptions: { leadDays: 1, safetyDays: 1, stockDays: 4, stockDaysByCategory: {} } })
    const input = rowOf('トマト').querySelector('.ob-input')
    input.value = '12'; input.dispatchEvent(new Event('change')); await nextTick()
    await click(rowOf('牛肉').querySelector('.ob-reset'))
    expect(ev.set).toEqual([['トマト', '12'], ['牛肉', '']])
  })

  it('未設定・仮で絞り込める', async () => {
    await mount({ rows, assumptions: { leadDays: 1, safetyDays: 1, stockDays: 4, stockDaysByCategory: {} } })
    await click(button('未設定 1'))
    expect(host.querySelectorAll('.ob-row')).toHaveLength(1)
    await click(button('仮 1'))
    expect(rowOf('トマト')).toBeTruthy()
    expect(host.querySelectorAll('.ob-row')).toHaveLength(1)
  })

  it('仮の値を使わない＝仮定を解除', async () => {
    const ev = await mount({ rows, assumptions: { leadDays: 1, safetyDays: 1, stockDays: 4, stockDaysByCategory: {} } })
    await click(button('仮の値を使わない'))
    expect(ev.save).toEqual([null])
  })
})
