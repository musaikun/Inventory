// スタッフ画面（User決定 2026-10-15・モック docs/mocks/staff-page-v2.html）:
// 一覧とログイン中をひとつに、人を押すと権限（4つのまとまり）と作業時間・やったこと
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

const staffAction = vi.fn(async () => ({}))
let staffList = []
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:,' } }))
vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  return {
    listStaff: vi.fn(async () => ({ staff: staffList, invites: [] })),
    createStaffInvite: vi.fn(), revokeStaffInvite: vi.fn(),
    staffAction: (...a) => staffAction(...a),
    ROLE_LABELS: { owner: 'オーナー', admin: '管理者', shain: '社員', arbeit: 'アルバイト' },
    currentStaff: ref(null), ownerName: ref('無才'), updateOwnerName: vi.fn(),
    getPresence: vi.fn(async () => ({ people: [
      { id: 'owner', name: '無才', owner: true, online: true, minutes: 480, lastSeenAt: new Date().toISOString() },
      { id: 'st_a', name: '山田', online: false, minutes: 370, lastSeenAt: new Date(Date.now() - 2 * 3600_000).toISOString() },
    ], sessions: [] })),
    getStaffActivity: vi.fn(async () => ({ work: [{ startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), minutes: 90 }],
      actions: [{ at: new Date().toISOString(), kind: 'stock', text: '棚卸を始めた' }, { at: new Date().toISOString(), kind: 'in', text: '入庫 2品目', sub: 'キャベツ ほか' }] })),
  }
})

let app = null, host = null
const tick = async () => { for (let i = 0; i < 8; i++) await nextTick(); await new Promise(r => setTimeout(r, 0)) }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
beforeEach(() => {
  staffAction.mockClear()
  staffList = [
    { id: 'st_a', name: '山田', role: 'arbeit', status: 'active', groups: ['inventory', 'tasks'], approvedAt: '2026-10-07T00:00:00Z' },
    { id: 'st_b', name: '佐藤', role: 'arbeit', status: 'pending', groups: ['inventory', 'tasks'] },
  ]
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('スタッフ画面', () => {
  it('一覧はオーナーとスタッフ、開いている人が上。承認待ちはその場で。押すと権限のスイッチとやったこと', async () => {
    const { default: StaffPage } = await import('./StaffPage.vue')
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp(StaffPage); app.mount(host); await tick()
    const names = [...host.querySelectorAll('.sp2-p .sp2-tx b')].map(b => b.textContent)
    expect(names[0]).toContain('無才')
    expect(names[1]).toContain('山田')
    expect(host.querySelector('.sp2-p').textContent).toContain('開いている')
    expect(host.textContent).toContain('在庫管理・タスク')
    expect(host.querySelector('.sp2-pend').textContent).toContain('佐藤さんから参加の申請')
    await click([...host.querySelectorAll('.sp2-pend button')].find(b => b.textContent === '承認'))
    expect(staffAction).toHaveBeenCalledWith('st_b', 'approve', undefined)

    await click([...host.querySelectorAll('.sp2-p')].find(p => p.textContent.includes('山田')))
    expect(host.querySelector('.sp2-title').textContent).toBe('山田')
    const sw = [...host.querySelectorAll('.sp2-perm')]
    expect(sw.map(p => p.querySelector('b').textContent)).toEqual(['在庫管理', 'タスク管理', 'データの更新', 'レポート・分析・証跡'])
    expect(sw.map(p => p.querySelector('.sp2-sw').getAttribute('aria-checked'))).toEqual(['true', 'true', 'false', 'false'])
    await click(sw[2].querySelector('.sp2-sw'))
    expect(staffAction).toHaveBeenLastCalledWith('st_a', 'grants', { groups: ['inventory', 'tasks', 'data'] })
    expect(host.querySelector('.sp2-lock').textContent).toContain('管理者だけ')
    expect(host.textContent).toContain('今週 1時間30分')
    await click([...host.querySelectorAll('.sp2-tabs button')].find(b => b.textContent === 'やったこと'))
    expect(host.textContent).toContain('棚卸を始めた')
    expect(host.textContent).toContain('キャベツ ほか')

    // オーナーの画面ではスイッチは全部オンで変えられない
    await click(host.querySelector('.sp2-back'))
    await click([...host.querySelectorAll('.sp2-p')].find(p => p.textContent.includes('無才')))
    expect([...host.querySelectorAll('.sp2-sw')].every(b => b.disabled && b.getAttribute('aria-checked') === 'true')).toBe(true)
  })
})
