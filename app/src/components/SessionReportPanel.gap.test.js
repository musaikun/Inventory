// 棚卸の結果に「帳簿との差」（PROD-001・User 2026-11-25）
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import SessionReportPanel from './SessionReportPanel.vue'
import { buildSessionReport } from '../services/sessionReport.js'

let app, host
afterEach(() => { app?.unmount(); host?.remove() })
async function mount(gap) {
  host = document.createElement('div'); document.body.appendChild(host)
  const report = buildSessionReport({ date: '2026-11-20', items: [{ item: 'トマト', qty: 8 }] })
  app = createApp({ render: () => h(SessionReportPanel, { report, gap }) }); app.mount(host); await nextTick()
}

describe('SessionReportPanel — 帳簿との差', () => {
  it('差のある品目を「帳簿 → 数えた数（差）」で出す', async () => {
    await mount({ compared: 2, diffCount: 1, list: [{ item: 'トマト', unit: '個', book: 14, counted: 8, gap: -6 }] })
    const card = host.querySelector('.rp-gap')
    expect(card.textContent).toContain('帳簿との差 1品目')
    expect(card.textContent).toContain('帳簿 14 → 8個（−6）')
  })
  it('差が無ければ「すべて帳簿どおり」。比べられる品目が無ければ出さない', async () => {
    await mount({ compared: 3, diffCount: 0, list: [] })
    expect(host.querySelector('.rp-gap').textContent).toContain('すべて帳簿どおりです')
    app.unmount(); host.remove()
    await mount({ compared: 0, diffCount: 0, list: [] })
    expect(host.querySelector('.rp-gap')).toBeNull()
  })
})
