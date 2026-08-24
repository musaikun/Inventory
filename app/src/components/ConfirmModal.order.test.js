// 発注モードの推奨（C: 発注数の決め方）の回帰。
// 守りたい契約:
//   ・目標は補充目標。発注点そのものへ戻すと補充直後にまた発注点を割る
//   ・学習（適正在庫）が無くても、発注点さえあれば推奨が出る（部分利用ファースト）
//   ・「自分で入力する」モードでは推奨を自動で入れない。どちらでも人が最後に直せる
//   ・推奨には必ず根拠を添える
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./ConfirmModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { confirm: [] }
  app = createApp({
    render: () => h(Modal, {
      ingredient: 'トマト', unit: '個',
      orderMode: true, orderLot: 12, initialQty: null,
      ...props,
      onConfirm: (p) => events.confirm.push(p),
      onCancel: () => {},
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}
const orderValue = () => host.querySelector('.order-qty-value').textContent.trim()
async function typeStock(digits) {
  // 発注モードのテンキーは既定で発注数を編集する。在庫欄をタップして対象を切り替える
  host.querySelector('.qty-row .qty-display').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  for (const d of String(digits)) {
    button(d).click()
    await nextTick()
  }
}

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('ConfirmModal — 発注モードの推奨', () => {
  it('補充目標を出し、根拠も添える', async () => {
    await mount({
      replenish: { value: 24, source: 'reorder', basis: '発注点 12 × 2（学習が貯まると自動で切り替わります）' },
    })
    expect(host.textContent).toContain('補充目標: 24')
    expect(host.querySelector('.order-basis').textContent).toContain('発注点 12 × 2')
  })

  it('学習が無くても、補充目標と在庫から推奨が出る', async () => {
    await mount({ parLevel: null, replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(8)
    // 不足16 → 入数12で1ケース
    expect(host.textContent).toContain('推奨: 1')
    expect(orderValue()).toBe('1')       // auto モードは発注数へ追従する
  })

  it('「自分で入力する」モードでは推奨を自動で入れない', async () => {
    await mount({ orderInputMode: 'manual', replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(8)
    expect(host.textContent).toContain('推奨: 1')   // 参考としては出す
    expect(orderValue()).toBe('0')                 // 発注数には入れない
  })

  it('推奨はタップで採用でき、そこから直せる', async () => {
    await mount({ orderInputMode: 'manual', replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(2)
    button('推奨: 1').click()
    await nextTick()
    expect(orderValue()).toBe('1')
    button('＋').click()
    await nextTick()
    expect(orderValue()).toBe('2')
  })

  it('足りていれば発注しない', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(24)
    expect(orderValue()).toBe('0')
  })

  it('補充目標が無ければ推奨を出さず、発注点を入れるよう案内する', async () => {
    await mount({ replenish: null, parLevel: null })
    await typeStock(8)
    expect(host.textContent).not.toContain('推奨:')
    expect(host.querySelector('.order-note').textContent).toContain('発注点を入れる')
  })
})
