// 日誌（やること・予定・記録。User決定 2026-10-09）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []), saveMovementToD1: vi.fn(async () => true) }))

let app = null, host = null
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = (label, root = host) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function mount(comp, props = {}) {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(comp, props) }); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })

describe('日誌', () => {
  it('リストは「やること」と「記録」を別の枠に。入出庫は続けて入れたものがまとまる', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask('2000-01-02', '製氷機のフィルター交換')
    T.addTask(localDateKey(), '野菜の検品', null, '11:00')
    const { useMovements } = await import('../composables/useMovements.js')
    const mv = useMovements()
    mv.saveMovement({ type: 'in', by: '山田', lines: [{ item: 'キャベツ', qty: 6, unit: '玉' }] })
    mv.saveMovement({ type: 'in', by: '山田', lines: [{ item: 'トマト', qty: 24, unit: '個' }] })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.jp-title').textContent).toContain('業務日誌')
    // やること: 期限切れ → 今日
    expect(host.querySelector('.jp-lh.late').textContent).toContain('期限切れ')
    expect(host.textContent).toContain('野菜の検品')
    expect(host.querySelector('.rr')).toBeNull()               // 記録はここには混ぜない
    // 記録: 2回の入庫が1件にまとまる。押すと品目と数
    await click(btn('記録', host.querySelector('.jp-flt')))
    const rows = host.querySelectorAll('.rr')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('入庫 2品目')
    expect(rows[0].textContent).toContain('山田')
    await click(rows[0].querySelector('.rr-main'))
    expect(host.querySelector('.rr-lines').textContent).toContain('トマト')
    expect(host.querySelector('.rr-lines').textContent).toContain('+24個')
  })

  it('1日: 時刻のあるやることは時間の帯、時刻なしは上に。記録も帯に。表示する時間は端末に覚える', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(), '野菜の検品', null, '11:00')
    T.addTask(localDateKey(), '手洗いの確認')
    const { useMovements } = await import('../composables/useMovements.js')
    useMovements().saveMovement({ type: 'out', by: '佐藤', lines: [{ item: '牛乳', qty: 1, unit: '本' }] })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('1日', host.querySelector('.jp-views')))
    expect(host.querySelector('.jd-allday').textContent).toContain('手洗いの確認')
    const evs = [...host.querySelectorAll('.jd-ev')].map(e => e.textContent)
    expect(evs.some(t => t.includes('11:00 野菜の検品'))).toBe(true)
    expect(evs.some(t => t.includes('出庫 1品目'))).toBe(true)
    // 時刻の帯を押すと、その場で完了・直せる
    await click([...host.querySelectorAll('.jd-ev')].find(e => e.textContent.includes('野菜の検品')))
    expect(document.body.querySelector('.jd-sheet .tr')).not.toBeNull()
    await click(btn('閉じる', document.body))
    // 表示する時間
    await click(host.querySelector('.jd-hours'))
    const [from, to] = document.body.querySelectorAll('.jd-sheet select')
    from.value = '10'; from.dispatchEvent(new Event('change'))
    to.value = '23'; to.dispatchEvent(new Event('change')); await tick()
    await click(btn('保存', document.body))
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.journalHours))).toEqual({ from: 10, to: 23 })
  })
})
