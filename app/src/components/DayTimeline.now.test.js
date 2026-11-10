// 一覧の「いま」の線: 今がどの行よりも前なら最初の行の上、行のあいだならその間に出す（User 2026-11-10）
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { buildDayTimeline } from '../services/dayTimeline.js'
import { localDateKey } from '../utils/localDate.js'

let app = null, host = null
afterEach(() => { app?.unmount(); host?.remove(); app = null; vi.useRealTimers() })

async function mountAt(hm, times) {
  const [H, M] = hm.split(':').map(Number)
  const now = new Date(); now.setHours(H, M, 0, 0)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  const today = localDateKey()
  const tasks = times.map((t, i) => ({ id: `t${i}`, date: today, text: `やること${i}`, dueTime: t }))
  const timeline = buildDayTimeline({ date: today, today, tasks })
  const { default: DayTimeline } = await import('./DayTimeline.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(DayTimeline, { date: today, today, timeline, initialView: 'list' }) }); app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  // 行と線を画面の順に並べる
  return [...host.querySelectorAll('.dt-body > .dt-row, .dt-body > .dt-now')].map(e => (e.classList.contains('dt-now') ? 'いま' : e.querySelector('b').textContent))
}

describe('一覧の「いま」の線', () => {
  it('今がどの行よりも前なら、最初の行の上', async () => {
    expect(await mountAt('08:51', ['09:00', '14:00'])).toEqual(['いま', 'やること0', 'やること1'])
  })
  it('行のあいだなら、その間', async () => {
    expect(await mountAt('10:00', ['09:00', '14:00'])).toEqual(['やること0', 'いま', 'やること1'])
  })
})
