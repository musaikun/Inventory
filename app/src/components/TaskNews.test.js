// やることの行（TaskRow）・1日の締切・知らせとナビのバッジ（User決定 2026-10-04）。
// 以前の日の詳細（DayTasks）は日誌の1日へ移して廃止した（2026-10-13）
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

describe('やることの行・1日の締切', () => {
  it('発注日の曜日には1日の帯に締切が出る', async () => {
    const { useConfig } = await import('../composables/useConfig.js')
    useConfig().config.orderSchedules = [{ id: 's1', name: '昼の仕入先', days: [0], deadline: '14:00' }]   // 日曜
    const { default: JournalDay } = await import('./JournalDay.vue')
    await mount(JournalDay, { date: '2026-10-04' })   // 日曜
    expect(host.querySelector('.jd-ev.plan').textContent).toContain('14:00 発注の締切（昼の仕入先）')
    expect(host.querySelector('.jd-sum').textContent).toContain('締切 1')
  })

  it('完了・消す・文面を押して直す（完了したものは直せない・消せない）。他の端末の追加には名前が出る', async () => {
    const T = await import('../composables/useTasks.js')
    T.applyRemoteTasks([{ id: 'x', date: '2026-10-05', text: '業者の点検', createdBy: '山田', createdById: 'other', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }])
    const mine = T.addTask('2026-10-05', '野菜の検品', null, '11:00')
    const { default: TaskRow } = await import('./TaskRow.vue')
    const { h, reactive } = await import('vue')
    const list = reactive({ ids: ['x', mine.id] })
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp({ render: () => list.ids.map(id => T.tasksOn('2026-10-05').find(t => t.id === id)).filter(Boolean).map(t => h(TaskRow, { task: t, key: t.id })) })
    app.mount(host); await tick()
    expect(host.textContent).toContain('山田さんが追加')
    await click(host.querySelectorAll('.tr-tx')[1])
    const form = host.querySelector('.tr-edit')
    const text = form.querySelector('input[type=text]')
    text.value = '野菜の検品（午後）'; text.dispatchEvent(new Event('input'))
    const time = form.querySelector('input[type=time]')
    time.value = '14:00'; time.dispatchEvent(new Event('input')); await tick()
    form.dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect(T.tasksOn('2026-10-05').find(t => t.id === mine.id)).toMatchObject({ text: '野菜の検品（午後）', dueTime: '14:00' })
    // 完了したら固める: 直す・消すのボタンは出さない
    await click(host.querySelectorAll('.tr-chk')[1])
    expect(host.querySelectorAll('.tr.done').length).toBe(1)
    expect(host.querySelectorAll('.tr')[1].querySelector('.tr-del')).toBeNull()
    expect(host.querySelectorAll('.tr')[1].querySelector('button.tr-tx')).toBeNull()
    // 未完了のもの（他の端末が作ったもの）はオーナー＝管理者なので消せる
    await click(host.querySelectorAll('.tr')[0].querySelector('.tr-del'))
    expect(T.tasksOn('2026-10-05').map(t => t.id)).toEqual([mine.id])
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

describe('参加申請のやること（User決定 2026-10-14）', () => {
  it('手では完了にできず、押すとスタッフの画面を開く。ホームに承認待ちの数', async () => {
    const T = await import('../composables/useTasks.js')
    T.applyRemoteTasks([{ id: 't_join_st_1', date: '2026-10-14', text: '山田さんから参加の申請がありました。承認するか決めてください', kind: 'staff_join', refId: 'st_1',
      assign: 'person', assigneeId: 'owner', assigneeName: '店長', createdBy: 'タナオロ', createdById: 'system', createdAt: '2026-10-14T00:00:00Z', updatedAt: '1' }])
    const t = T.tasksOn('2026-10-14')[0]
    const { default: TaskRow } = await import('./TaskRow.vue')
    await mount(TaskRow, { task: t })
    expect(host.querySelector('.tr-chk').disabled).toBe(true)
    expect(host.querySelector('.tr-del')).toBeNull()
    expect(T.toggleTask(t.id)).toBeNull()
    const nav = await import('../composables/staffNav.js')
    await click(host.querySelector('button.tr-tx'))
    expect(nav.staffPageOpen.value).toBe(true)
  })
})
})
