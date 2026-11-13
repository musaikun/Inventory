// 棚卸を終えた直後のまとめ。履歴詳細と同じ数え方（buildSessionReport）で出すこと、
// 金額を見られない人には金額を出さないことを確かめる。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const { money } = vi.hoisted(() => ({ money: { value: true } }))
vi.mock('../composables/useAuth.js', () => ({ canSeeMoney: money }))

import Sheet from './StocktakeDoneSheet.vue'

let app = null
async function mount(props, on = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Sheet, { ...props, ...on }) })
  app.mount(host)
  await nextTick()
}
const text = () => document.body.textContent.replace(/\s+/g, ' ')
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ''; money.value = true })

const snap = {
  sessionId: 's2', date: '2026-11-13', savedAt: '2026-11-13T06:00:00.000Z', totalValue: 1340,
  items: [
    { item: 'コーラ', qty: 10, unitPrice: 90, total: 900 },
    { item: '牛乳', qty: 2, unitPrice: 220, total: 440 },
    { item: 'レモン', qty: 8, unitPrice: null, total: null },
    { item: '豚バラ', qty: null, unitPrice: 1480, total: null },
  ],
}

describe('StocktakeDoneSheet', () => {
  it('数えた品目数・在庫金額・数えていない品目・単価のない品目を出す', async () => {
    await mount({ snapshot: snap })
    const t = text()
    expect(t).toContain('3品目を数えました')
    expect(t).toContain('¥1,340')
    expect(t).toContain('数えていない品目 1')
    expect(t).toContain('単価のない品目 1')
  })

  it('前回があれば金額の差を出す', async () => {
    await mount({ snapshot: snap, prev: { sessionId: 's1', date: '2026-10-31', totalValue: 1000, items: [] } })
    expect(text()).toContain('前回より +¥340')
  })

  it('金額を見られない人には金額を出さない', async () => {
    money.value = false
    await mount({ snapshot: snap })
    const t = text()
    expect(t).toContain('3品目を数えました')
    expect(t).not.toContain('¥')
    expect(t).not.toContain('単価のない品目')
  })

  it('「結果を見る」「閉じる」を親へ伝える', async () => {
    const onDetail = vi.fn(), onClose = vi.fn()
    await mount({ snapshot: snap }, { onDetail, onClose })
    const btn = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name)
    btn('結果を見る').click()
    btn('閉じる').click()
    expect(onDetail).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
