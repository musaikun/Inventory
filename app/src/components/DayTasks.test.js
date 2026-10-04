// カレンダーの日の詳細の「予定」「やること」と、カレンダータブの知らせ・ナビのバッジ（User決定 2026-10-04）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []) }))

let app = null, host = null
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
async function mount(comp, props = {}) {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(comp, props) }); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('日の詳細の予定・やること', () => {
  it('発注日の曜日には締切が「自動」で出る', async () => {
    const { useConfig } = await import('../composables/useConfig.js')
    const cfg = useConfig()
    cfg.config.orderSchedules = [{ id: 's1', name: '昼の仕入先', days: [0], deadline: '14:00' }]   // 日曜
    const { default: DayTasks } = await import('./DayTasks.vue')
    await mount(DayTasks, { date: '2026-10-04' })   // 日曜
    expect(host.textContent).toContain('発注の締切')
    expect(host.textContent).toContain('昼の仕入先')
    expect(host.textContent).toContain('14:00')
  })

  it('その場で追加・完了・消す。他の端末の追加には名前が出る', async () => {
    const T = await import('../composables/useTasks.js')
    T.applyRemoteTasks([{ id: 'x', date: '2026-10-05', text: '業者の点検', createdBy: '山田', createdById: 'other', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }])
    const { default: DayTasks } = await import('./DayTasks.vue')
    await mount(DayTasks, { date: '2026-10-05' })
    expect(host.textContent).toContain('山田さんが追加')
    const input = host.querySelector('.dt-add input')
    input.value = '霜取り'; input.dispatchEvent(new Event('input')); await tick()
    host.querySelector('.dt-add').dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect([...host.querySelectorAll('.dt-tx')].map(e => e.firstChild.textContent.trim())).toEqual(['業者の点検', '霜取り'])
    await click(host.querySelectorAll('.dt-chk')[1])
    expect(host.querySelectorAll('.dt-row.done').length).toBe(1)
    await click(host.querySelectorAll('.dt-del')[1])
    expect(host.querySelectorAll('.dt-tx').length).toBe(1)
  })
})

describe('知らせとバッジ', () => {
  it('他の端末が追加したら、ナビのバッジが「新着」になり、カレンダータブの知らせを確認すると消える', async () => {
    const T = await import('../composables/useTasks.js')
    T.applyRemoteTasks([])   // 初めて読んだ（ここまでを確認済みにする）
    const later = new Date(Date.now() + 1000).toISOString()
    T.applyRemoteTasks([{ id: 'n1', date: '2026-10-06', text: '製氷機のフィルター交換', createdBy: '山田', createdById: 'other', createdAt: later, updatedAt: later }])
    const { default: Nav } = await import('./HomeFooterNav.vue')
    await mount(Nav, { active: 'sessions' })
    expect(host.querySelector('.bnav-badge').textContent).toBe('新着')
    app.unmount(); host.remove()
    const { default: News } = await import('./TaskNews.vue')
    await mount(News)
    expect(host.textContent).toContain('山田さんがやることを1件追加しました')
    expect(host.textContent).toContain('10/6 製氷機のフィルター交換')
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.now() + 5000))
    await click(host.querySelector('.tn-ok'))
    vi.useRealTimers()
    expect(host.querySelector('.tn')).toBeNull()
  })
})
