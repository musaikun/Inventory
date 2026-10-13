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

  it('1日: 時刻のあるやることは時間の帯、時刻なしは「今日中」の列に。記録も帯に。表示する時間は端末に覚える', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(), '野菜の検品', null, '11:00')
    T.addTask(localDateKey(), '手洗いの確認')
    const { useMovements } = await import('../composables/useMovements.js')
    useMovements().saveMovement({ type: 'out', by: '佐藤', lines: [{ item: '牛乳', qty: 1, unit: '本' }] })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('1日', host.querySelector('.jp-views')))
    // 時刻なしは「今日中」の列（残りの数）。押すと一覧
    expect(host.querySelector('.jd-lane').textContent).toContain('今日中1/1')
    expect(host.querySelector('.jd-sum').textContent).toContain('やること 0/2')
    await click(host.querySelector('.jd-lane'))
    expect(document.body.querySelector('.jd-sheet').textContent).toContain('手洗いの確認')
    await click(btn('閉じる', document.body))
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

  it('済み: 終えたやることを終えた日ごとに。誰が・期限から遅れたか。✓ を外すと「やること」へ戻る', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    const ago = localDateKey(new Date(Date.now() - 2 * 86400_000))
    T.addTask(today, '野菜の検品')
    const oil = T.addTask(ago, '油の交換')
    T.toggleTask(oil.id)
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('済み', host.querySelector('.jp-flt')))
    const rows = host.querySelectorAll('.dt')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('油の交換')
    expect(rows[0].textContent).toContain('あなたが')
    expect(rows[0].querySelector('.dt-tag').textContent).toBe('2日遅れ')
    expect(host.textContent).not.toContain('野菜の検品')
    await click(rows[0].querySelector('.dt-chk'))
    expect(host.querySelectorAll('.dt')).toHaveLength(0)
    await click(btn('やること', host.querySelector('.jp-flt')))
    expect(host.querySelector('.jp-lh.late').textContent).toContain('期限切れ')
    expect(host.textContent).toContain('油の交換')
  })

  it('1日: 日付を押すと月カレンダーで選べる（その日にあったことのドット）。日別メモもここで', async () => {
    const T = await import('../composables/useTasks.js')
    T.addTask('2026-09-15', '冷蔵庫の点検')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('1日', host.querySelector('.jp-views')))
    await click(host.querySelector('.jd-date'))
    const dp = document.body.querySelector('.dp')
    // 2026年9月まで戻る
    const { localDateKey } = await import('../utils/localDate.js')
    const now = new Date(localDateKey() + 'T00:00:00')
    const back = (now.getFullYear() - 2026) * 12 + now.getMonth() - 8
    for (let i = 0; i < back; i++) await click(dp.querySelector('[aria-label="前の月"]'))
    const cell = dp.querySelector('[aria-label="2026-09-15"]')
    expect(cell.querySelector('.k-task')).not.toBeNull()
    await click(cell)
    expect(document.body.querySelector('.dp')).toBeNull()
    expect(host.querySelector('.jd-date').textContent).toContain('9月15日')
    expect(host.querySelector('.jd-lane').textContent).toContain('今日中')
    // 日別メモ（発注学習の除外）
    await click(host.querySelector('.jd-sum .memo'))
    const ta = document.body.querySelector('.jd-memo')
    ta.value = '貸切'; ta.dispatchEvent(new Event('input')); await tick()
    await click(btn('保存', document.body))
    expect(host.querySelector('.jd-sum .memo').textContent).toContain('貸切')
    await click(btn('今日へ', host))
    expect(host.querySelector('.jd-date').textContent).toContain('今日')
  })

  it('月: 日付を押すとモーダルではなく、その日の「1日」へ', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('月', host.querySelector('.jp-views')))
    await new Promise(r => setTimeout(r, 0)); await tick()
    const cell = [...host.querySelectorAll('.hc-cell.tappable')].find(c => c.querySelector('.hc-day')?.textContent.trim() === '1')
    await click(cell)
    expect(document.body.querySelector('.modal-overlay')).toBeNull()
    expect(host.querySelector('.jp-views .on').textContent).toBe('1日')
    expect(host.querySelector('.jd-date').textContent).toMatch(/月1日/)
  })

  it('いつか: 追加で「いつか」を選ぶと日付なしで、リストの一番下にたたんで出る。切り替えは下の帯', async () => {
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.jp-top .jp-views')).toBeNull()      // 上のタブではない
    expect(host.querySelector('.jp > .jp-views')).not.toBeNull()
    await click(host.querySelector('.jp-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const text = form.querySelector('input[type=text]')
    text.value = 'メニュー表の作り直し'; text.dispatchEvent(new Event('input'))
    const chk = form.querySelector('.jp-chk input')
    chk.checked = true; chk.dispatchEvent(new Event('change')); await tick()
    expect(form.querySelector('input[type=date]')).toBeNull()
    form.dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect(T.somedayTasks.value.map(t => t.text)).toEqual(['メニュー表の作り直し'])
    expect(host.querySelector('.jp-title small').textContent).toBe('残り 0')
    const head = host.querySelector('.jp-someday')
    expect(head.textContent).toContain('いつか')
    expect(host.textContent).not.toContain('メニュー表の作り直し')    // たたんである
    await click(head)
    expect(host.textContent).toContain('メニュー表の作り直し')
  })

  it('1日: 長くて中断の多い棚卸も、始め〜終わりを1本につなげ、中断はその中に重ねる', async () => {
    const at = hm => new Date(`2026-08-31T${hm}:00`).getTime()
    const pauses = [['11:05', '11:20'], ['12:10', '12:30'], ['13:00', '13:02'], ['13:30', '13:50'], ['15:20', '16:02']].map(([f, t]) => ({ from: at(f), to: at(t), ms: at(t) - at(f) }))
    const rec = { key: 'stock-s1', kind: 'stock', at: at('10:35'), end: at('16:20'), pauses, activeMs: 4 * 3600_000, title: '棚卸', session: { id: 's1' } }
    const { default: JournalDay } = await import('./JournalDay.vue')
    await mount(JournalDay, { date: '2026-08-31', records: [rec] })
    const blocks = host.querySelectorAll('.jd-ev.stock')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].querySelector('.jd-stock-t').textContent).toContain('棚卸 10:35〜16:20')
    expect(blocks[0].querySelector('.jd-stock-t').textContent).toContain('中断5回 1時間39分')
    const ps = blocks[0].querySelectorAll('.jd-pause')
    expect(ps).toHaveLength(5)
    expect(ps[2].textContent).toBe('')                 // 2分の中断は文字なし
    expect(ps[4].textContent).toBe('中断 42分')
  })
})
