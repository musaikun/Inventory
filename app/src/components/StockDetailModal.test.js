// 在庫の詳細を行アコーディオンからシートへ移したことの回帰。
// ここは「見るだけ」の画面ではなく、部分利用のユーザーが頼る発注点をその場で直せることが要件。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./StockDetailModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { updateReorder: [], close: [] }
  app = createApp({
    render: () => h(Modal, {
      item: 'トマト', unit: '個',
      ...props,
      onUpdateReorder: (v) => events.updateReorder.push(v),
      onClose: () => events.close.push(true),
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('StockDetailModal', () => {
  it('理論在庫と内訳を出す', async () => {
    await mount({ theo: 10, basis: '8/1棚卸 10 ＋入庫3 −出庫2' })
    expect(host.querySelector('.sd-qty').textContent).toContain('10')
    expect(host.querySelector('.sd-basis').textContent).toContain('8/1棚卸')
    // 理論値である旨の注意は必ず出す
    expect(host.textContent).toContain('正確な数は棚卸で確定します')
  })

  it('記録が無ければ理論在庫は「—」', async () => {
    await mount({ theo: null })
    expect(host.querySelector('.sd-qty').textContent.trim()).toBe('—')
  })

  it('発注点を直せる', async () => {
    const events = await mount({ theo: 10, reorder: 3 })
    const input = host.querySelector('.sd-rp-input')
    expect(input.value).toBe('3')
    input.value = '5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(events.updateReorder).toEqual(['5'])
  })

  it('目安があれば採用でき、根拠も出す', async () => {
    const events = await mount({ theo: 2, suggested: 7, suggestBasis: '推定消費 1.0/日 × 7日' })
    expect(host.textContent).toContain('推定消費 1.0/日 × 7日')
    host.querySelector('.sd-suggest-btn').click()
    await nextTick()
    expect(events.updateReorder).toEqual([7])
  })

  it('目安を出せないときは理由を出す（誤った数字を出さない）', async () => {
    await mount({ theo: 2, suggested: null, hint: '棚卸があと1回あれば、消費量・適正在庫を算出できます' })
    expect(host.querySelector('.sd-suggest-btn')).toBeNull()
    expect(host.querySelector('.sd-hint').textContent).toContain('あと1回')
  })

  it('発注点を下回っていれば要補充を出す', async () => {
    await mount({ theo: 2, reorder: 3 })
    expect(host.querySelector('.sd-badge').textContent).toContain('要補充')
    await mount({ theo: 5, reorder: 3 })
  })

  it('直近の入出庫を出す。無ければその旨を出す', async () => {
    await mount({ theo: 5, movements: [{ id: 'm1', date: '2026-08-10', type: 'out', qty: 2, unit: '個', note: 'まかない' }] })
    expect(host.textContent).toContain('8/10')
    expect(host.textContent).toContain('出庫')
    expect(host.textContent).toContain('まかない')

    app.unmount(); host.remove()
    await mount({ theo: 5, movements: [] })
    expect(host.textContent).toContain('入出庫の記録はまだありません')
  })
})
