// 入出庫の数量入力を棚卸・発注と同じ NumPad にそろえたことの回帰。
// 守りたいのは「保存されるのはバラ換算後の個数」という既存契約。
// ＋箱は入力補助であって、ロット数で保存する機能ではない（理論在庫がずれる）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./MovementQtyModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { confirm: [], cancel: [] }
  app = createApp({
    render: () => h(Modal, {
      item: 'トマト', mode: 'in', qty: 0, unit: '個', lot: null, theo: null,
      ...props,
      onConfirm: (v) => events.confirm.push(v),
      onCancel:  ()  => events.cancel.push(true),
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}

function button(label) {
  const el = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
  if (!el) throw new Error(`button not found: ${label} / had: ${[...host.querySelectorAll('button')].map(b => b.textContent.trim())}`)
  return el
}
async function press(label) { button(label).click(); await nextTick() }
const shown = () => host.querySelector('.mq-num').textContent.trim()

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('MovementQtyModal', () => {
  it('NumPad で打った数量を返す', async () => {
    const events = await mount({})
    await press('1'); await press('2')
    expect(shown()).toBe('12')
    await press('この数量にする')
    expect(events.confirm).toEqual([12])
  })

  it('現在の入力値から開き、⌫で直せる', async () => {
    await mount({ qty: 24 })
    expect(shown()).toBe('24')
    await press('⌫')
    expect(shown()).toBe('2')
  })

  it('＋箱は入数ぶんの「個数」を足す（ロット数では返さない）', async () => {
    const events = await mount({ lot: 12 })
    await press('＋箱（12）')
    await press('＋箱（12）')
    expect(shown()).toBe('24')
    expect(host.textContent).toContain('2ケース')
    await press('この数量にする')
    expect(events.confirm).toEqual([24])   // 2ではなく24
  })

  it('出庫には＋箱を出さない（出庫は個数で記録する）', async () => {
    await mount({ mode: 'out', lot: 12 })
    expect([...host.querySelectorAll('button')].some(b => b.textContent.includes('＋箱'))).toBe(false)
  })

  it('記録後の理論在庫を、入庫は加算・出庫は減算で見せる', async () => {
    await mount({ theo: 10 })
    await press('3')
    expect(host.querySelector('.mq-theo').textContent).toContain('13')

    app.unmount(); host.remove()
    await mount({ theo: 10, mode: 'out' })
    await press('3')
    expect(host.querySelector('.mq-theo').textContent).toContain('7')
  })

  it('0のまま確定すると入力の取り消しになる', async () => {
    const events = await mount({ qty: 5 })
    await press('C')
    await press('入力を取り消す')
    expect(events.confirm).toEqual([0])
  })
})
