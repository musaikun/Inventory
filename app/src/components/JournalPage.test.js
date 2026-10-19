// 日誌（やること・予定・記録。User決定 2026-10-09）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []), saveMovementToD1: vi.fn(async () => true),
  saveChecklistToD1: vi.fn(async () => ({ ok: true })), markChecklistInD1: vi.fn(async () => ({ ok: true })), loadChecklistsFromD1: vi.fn(async () => null) }))

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

  it('1日: 時刻のあるやることは時間の帯、時刻なしは上の「終日・時刻なし」の帯に（押すとその場で完了）。記録も帯に。表示する時間は端末に覚える', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(), '野菜の検品', null, '11:00')
    T.addTask(localDateKey(), '手洗いの確認')
    const { useMovements } = await import('../composables/useMovements.js')
    useMovements().saveMovement({ type: 'out', by: '佐藤', lines: [{ item: '牛乳', qty: 1, unit: '本' }] })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('1日', host.querySelector('.jp-views')))
    // 時刻なしは日付の下の帯（残りの数）。札を押すとその場で完了、見出しを押すと一覧
    const band = host.querySelector('.jd-head .jd-band')
    expect(band.textContent).toContain('終日・時刻なし')
    expect(band.textContent).toContain('1 / 1 残り')
    expect(host.querySelector('.jd-sum').textContent).toContain('やること 0/2')
    await click([...band.querySelectorAll('.jd-chip')].find(c => c.textContent.includes('手洗いの確認')))
    expect(host.querySelector('.jd-chip.task.done')).not.toBeNull()
    expect(host.querySelector('.jd-sum').textContent).toContain('やること 1/2')
    expect(host.querySelector('.jd-band').textContent).toContain('0 / 1 残り')
    await click(host.querySelector('.jd-band-h'))
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
    const late = host.querySelector('.jd-band .jd-chip.late')   // 過ぎた日の残りは赤
    expect(late.textContent).toContain('冷蔵庫の点検')
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
    await click(btn('みんなに見せて追加', form))
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

  it('管理者は追加のたびに「みんなに見せて追加」「管理者だけで追加」を選ぶ（チェックの付け忘れ・付けすぎを防ぐ・2026-10-19）', async () => {
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const add = async (text, label) => {
      await click(host.querySelector('.jp-fab'))
      const form = document.body.querySelector('.jp-sheet')
      expect(form.textContent).not.toContain('管理者だけに見せる')   // チェックは無い
      const input = form.querySelector('input[type=text]')
      input.value = text; input.dispatchEvent(new Event('input')); await tick()
      form.dispatchEvent(new Event('submit', { cancelable: true })); await tick()
      expect(document.body.querySelector('.jp-sheet'), 'Enter では決めない（どちらに見せるか選ばせる）').not.toBeNull()
      await click(btn(label, form))
    }
    await add('面談の準備', '管理者だけで追加')
    await add('冷蔵庫の掃除', 'みんなに見せて追加')
    const vis = Object.fromEntries(T.aliveTasks.value.map(t => [t.text, t.visibility ?? null]))
    expect(vis).toEqual({ 面談の準備: 'admins', 冷蔵庫の掃除: null })
  })

  it('左右のスワイプでリスト・月・1日を切り替える（2026-10-14）', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const jp = host.querySelector('.jp')
    const swipe = async dx => {
      const t = (x) => ({ changedTouches: [{ clientX: x, clientY: 300 }] })
      const ev = (type, x) => { const e = new Event(type, { bubbles: true }); Object.assign(e, t(x)); jp.dispatchEvent(e) }
      ev('touchstart', 200); ev('touchmove', 200 + dx / 2); ev('touchmove', 200 + dx); ev('touchend', 200 + dx); await tick()
    }
    const on = () => host.querySelector('.jp-views .on').textContent
    expect(on()).toBe('リスト')
    await swipe(-120); expect(on()).toBe('月')
    await swipe(-120); expect(on()).toBe('1日')
    await swipe(-120); expect(on()).toBe('1日')      // 端で止まる
    await swipe(120);  expect(on()).toBe('月')
  })
  it('チェック表: 今日の分がリストと「1日」に出る。時刻ありは時間の帯、なしは上の帯。押すと✓のシートで✓・今日はなし', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const items = [{ id: 'a', text: 'ガスの元栓' }, { id: 'b', text: 'ダスター漂白' }]
    localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify({ lists: [
      { id: 'c1', name: '退店チェック', items, repeat: 'daily', startDate: '2026-01-01', dueTime: '22:00', assign: 'anyone' },
      { id: 'c2', name: '週末の大掃除', items, repeat: 'daily', startDate: '2026-01-01', dueTime: null, assign: 'anyone' },
    ], runs: {} }))
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const rows = [...host.querySelectorAll('.jp-clrow')].map(r => r.textContent)
    expect(rows[0]).toContain('22:00 退店チェック')
    expect(rows[0]).toContain('0/2')
    await click(btn('1日', host.querySelector('.jp-views')))
    expect(host.querySelector('.jd-sum').textContent).toContain('チェック表 0/2')
    expect(host.querySelector('.jd-band .jd-chip.list').textContent).toContain('週末の大掃除')
    const ev = [...host.querySelectorAll('.jd-ev.list')].find(e => e.textContent.includes('退店チェック'))
    expect(ev.textContent).toContain('0/2')
    await click(ev)
    const sheet = document.body.querySelector('.cr')
    expect(sheet.textContent).toContain('ガスの元栓')
    await click(sheet.querySelector('.cr-box'))
    expect(sheet.querySelector('.cr-li.done').textContent).toContain('高木')
    await click(btn('今日はなし', sheet))
    const reason = sheet.querySelector('.cr-pop input')
    reason.value = '漂白剤切れ'; reason.dispatchEvent(new Event('input')); await tick()
    await click(btn('今日はなしにする', sheet))
    expect(sheet.querySelector('.cr-li.skip').textContent).toContain('漂白剤切れ')
    const { markChecklistInD1 } = await import('../composables/useStore.js')
    expect(markChecklistInD1).toHaveBeenLastCalledWith('c1', localDateKey(), expect.objectContaining({ itemId: 'b', state: 'skip', reason: '漂白剤切れ' }))
    await click(btn('閉じる', sheet))
    // 「今日はなし」も済みに数える
    expect([...host.querySelectorAll('.jd-ev.list')].find(e => e.textContent.includes('退店チェック')).classList.contains('done')).toBe(true)
    expect(host.querySelector('.jd-sum').textContent).toContain('チェック表 1/2')
  })

  it('チェック表: 管理者は見本から作れる。記録に今日の途中が出る', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('チェック表', host.querySelector('.jp-title')))
    const page = document.body.querySelector('.cp')
    expect(page.textContent).toContain('まだチェック表はありません')
    await click(btn('退店チェック', page))
    const names = [...page.querySelectorAll('.cp-it input')].map(i => i.value)
    expect(names).toContain('ガスの元栓')
    await click(btn('時刻を決める', page))
    const t = page.querySelector('input[type="time"]')
    t.value = '22:00'; t.dispatchEvent(new Event('input')); await tick()
    await click(btn('保存', page))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenCalledWith(expect.objectContaining({ name: '🌙 退店チェック', repeat: 'daily', dueTime: '22:00' }))
    expect(page.querySelector('.cp-card').textContent).toContain('毎日 22:00')
    await click(btn('記録', page.querySelector('.cp-card')))
    expect(page.querySelector('.cp-rec').textContent).toContain('途中 0/5')
  })
})
