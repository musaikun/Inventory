// 発注点の設定（管理タブ）：品目名で探せる（品目シートから発注点を外したため・User決定 2026-10-03）
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import OrderBaseModal from './OrderBaseModal.vue'

let app, host
afterEach(() => { app?.unmount(); host?.remove() })

describe('発注点の設定', () => {
  it('品目名で絞り込める', async () => {
    host = document.createElement('div'); document.body.appendChild(host)
    const rows = [
      { item: 'ホットコーヒー豆', category: 'コーヒー', reorder: null, target: null },
      { item: '牛乳', category: '乳製品', reorder: null, target: null },
    ]
    app = createApp({ render: () => h(OrderBaseModal, { rows, assumptions: { leadDays: 1, safetyDays: 1 } }) })
    app.mount(host); await nextTick()
    expect(host.querySelectorAll('.ob-row').length).toBe(2)
    const q = host.querySelector('.ob-search')
    q.value = 'コーヒー'; q.dispatchEvent(new Event('input')); await nextTick()
    expect([...host.querySelectorAll('.ob-row .ob-item')].map(e => e.textContent.trim())).toEqual([expect.stringContaining('ホットコーヒー豆')])
  })
})
