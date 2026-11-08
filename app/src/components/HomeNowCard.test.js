// ホームの「店の今」カード（User決定 2026-11-08）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []) }))

let app = null, host = null, opened = 0
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
async function mount() {
  const { default: Card } = await import('./HomeNowCard.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(Card, { onOpen: () => opened++ }) }); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木'); opened = 0 })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('店の今', () => {
  it('出すものが無ければカードごと出さない', async () => {
    await mount()
    expect(host.querySelector('.hn')).toBeNull()
  })

  it('時刻のあるやることは今日の流れに帯で、進行中は締め切りまでの棒で出る。押すと業務管理へ', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const d = localDateKey()
    T.addTask(d, '揚げ油の交換', null, '00:00', { endTime: '23:55' })
    const later = new Date(); later.setDate(later.getDate() + 5)
    T.addTask(d, '製氷機の修理の手配', null, null, { progress: 'doing', deadline: localDateKey(later) })
    await mount()
    expect(host.querySelector('.hn')).not.toBeNull()
    const bar = host.querySelector('.hn-bar')
    expect(bar.getAttribute('title')).toContain('揚げ油の交換')
    expect(bar.dataset.state).toBe('now')
    expect(host.querySelector('.hn-who').textContent).toContain('全員')
    expect(host.querySelector('.hn-pg .t').textContent).toBe('製氷機の修理の手配')
    expect(host.querySelector('.hn-pm').textContent).toContain(`${later.getMonth() + 1}/${later.getDate()}まで`)
    host.querySelector('.hn').dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(opened).toBe(1)
  })
})
