// 日誌（やること・予定・記録。User決定 2026-10-09）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []), saveMovementToD1: vi.fn(async () => true),
  saveChecklistToD1: vi.fn(async () => ({ ok: true })), markChecklistInD1: vi.fn(async () => ({ ok: true })), loadChecklistsFromD1: vi.fn(async () => null),
  loadHandoffsFromD1: vi.fn(async () => null), addHandoffToD1: vi.fn(async b => ({ ok: true, handoff: { ...b, reads: [], createdAt: new Date().toISOString() } })),
  actHandoffInD1: vi.fn(async () => ({ ok: true })),
  loadTaskNotesFromD1: vi.fn(async () => []), addTaskNoteToD1: vi.fn(async (id, n) => ({ ok: true, note: { id: 'n1', body: n.body, by: n.by, at: new Date().toISOString() } })) }))

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


// 日を押して、その日のタイムラインを開く
async function openDay(key) {
  await click(host.querySelector(`.jm-c[aria-label^="${key}"]`))
  return host.querySelector('.dt')
}

describe('日誌（月のカレンダー → 日を押すとタイムライン・2026-10-26）', () => {
  it('開くと月のカレンダー。過ぎた日の残りは赤い帯・済みは緑。札は棚卸・発注・メモ', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    const d = new Date(); d.setDate(d.getDate() - 1)
    const yday = localDateKey(d)
    const sameMonth = yday.slice(0, 7) === today.slice(0, 7)
    T.addTask(yday, '油の交換')
    const done = T.addTask(today, '検品'); T.toggleTask(done.id)
    const { useDayNotes } = await import('../composables/useDayNotes.js')
    useDayNotes().setNote(today, { text: '20時から貸切' })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.jm')).not.toBeNull()
    expect(host.querySelector('.dt')).toBeNull()                    // 最初は月だけ
    const cell = host.querySelector(`.jm-c[aria-label^="${today}"]`)
    expect(cell.classList.contains('today')).toBe(true)
    expect(cell.querySelector('.st.y')).not.toBeNull()
    expect(cell.querySelector('.tag.plan').textContent).toBe('20時から貸切'.slice(0, 8))
    if (sameMonth) expect(host.querySelector(`.jm-c[aria-label^="${yday}"] .st.x`)).not.toBeNull()
  })

  it('日を押すとタイムライン。終日（期限切れ）→ 時刻の順。丸を押すと済む。月にもどる・前後の日', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify({ lists: [
      { id: 'c1', name: '退店チェック', items: [{ id: 'a', text: 'ガスの元栓' }], repeat: 'daily', startDate: '2026-01-01', dueTimes: ['22:00'], assign: 'anyone' },
      { id: 'c2', name: 'ゴミ出し', items: [], repeat: 'daily', startDate: '2026-01-01', dueTimes: ['21:30'], assign: 'anyone' },
    ], runs: {} }))
    const veg = T.addTask(today, '野菜の検品', null, '11:00')
    T.addTask(localDateKey(new Date(Date.now() - 2 * 86400_000)), '油の交換')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const dt = await openDay(today)
    expect(dt.querySelector('.dt-t').textContent).toContain('今日')
    expect(dt.querySelector('.dt-all').textContent).toContain('油の交換')
    expect([...dt.querySelectorAll('.dt-row .dt-card b')].map(b => b.textContent)).toEqual(['野菜の検品', 'ゴミ出し', '退店チェック'])
    expect(dt.querySelector('.dt-ring').textContent).toBe('0/4')
    // 丸: やることは済む、項目なしのルーティンも済む、項目のあるものは✓の画面
    const rows = () => [...host.querySelectorAll('.dt-row')]
    await click(rows()[0].querySelector('.dt-dot'))
    expect(T.tasksOn(today).find(t => t.id === veg.id).doneAt).toBeTruthy()
    await click(rows()[1].querySelector('.dt-dot'))
    const { markChecklistInD1 } = await import('../composables/useStore.js')
    expect(markChecklistInD1).toHaveBeenLastCalledWith('c2', today, expect.objectContaining({ itemId: '_', state: 'done', slot: '21:30' }))
    expect(host.querySelector('.dt-ring').textContent).toBe('2/4')
    await click(rows()[2].querySelector('.dt-dot'))
    expect(document.body.querySelector('.cr').textContent).toContain('ガスの元栓')
    await click(btn('あとで続ける', document.body.querySelector('.cr')))
    // 前後の日・月にもどる
    await click(host.querySelector('[aria-label="次の日"]'))
    expect(host.querySelector('.dt-t').textContent).toContain('予定')
    await click(host.querySelector('[aria-label="月にもどる"]'))
    expect(host.querySelector('.dt')).toBeNull()
  })

  it('記録もタイムラインに（入出庫は続けて入れたものがまとまる）。行を押すと中身', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { useMovements } = await import('../composables/useMovements.js')
    const mv = useMovements()
    mv.saveMovement({ type: 'in', by: '山田', lines: [{ item: 'キャベツ', qty: 6, unit: '玉' }] })
    mv.saveMovement({ type: 'in', by: '山田', lines: [{ item: 'トマト', qty: 24, unit: '個' }] })
    const T = await import('../composables/useTasks.js')
    const t = T.addTask(localDateKey(), '手洗いの確認', null, '23:59')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const dt = await openDay(localDateKey())
    const rec = [...dt.querySelectorAll('.dt-row')].find(r => r.textContent.includes('入庫 2品目'))
    expect(rec.textContent).toContain('山田')
    expect(rec.textContent).toContain('キャベツ・トマト')
    // やることの行を押すと、直せる1件のシート
    await click([...dt.querySelectorAll('.dt-card')].find(c => c.textContent.includes('手洗いの確認')))
    expect(document.body.querySelector('.jp-sheet .tr').textContent).toContain(t.text)
  })

  it('＋でその日に追加。「いつか」は今日の終日に出る。管理者は見せ方を2つのボタンで選ぶ', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await openDay(localDateKey())
    await click(host.querySelector('.dt-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const text = form.querySelector('input[type=text]')
    text.value = 'メニュー表の作り直し'; text.dispatchEvent(new Event('input'))
    const chk = form.querySelector('.jp-chk input')
    chk.checked = true; chk.dispatchEvent(new Event('change')); await tick()
    await click(btn('みんなに見せて追加', form))
    expect(T.somedayTasks.value.map(t => t.text)).toEqual(['メニュー表の作り直し'])
    const ad = [...host.querySelectorAll('.dt-ad')].find(x => x.textContent.includes('メニュー表の作り直し'))
    expect(ad.textContent).toContain('いつか')
  })

  it('管理者は追加のたびに「みんなに見せて追加」「管理者だけで追加」を選ぶ（チェックの付け忘れ・付けすぎを防ぐ・2026-10-19）', async () => {
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    T.addTask(new Date().toISOString().slice(0, 10), 'x')   // 何もない店の画面にしない
    await mount(JournalPage)
    await openDay(new Date().toISOString().slice(0, 10))
    const add = async (text, label) => {
      await click(host.querySelector('.dt-fab'))
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
    expect(vis).toEqual({ x: null, 面談の準備: 'admins', 冷蔵庫の掃除: null })
  })

  it('進行中: 「⏳ 何日かかかる」で作る。次に見る日は選ばず、済むまで毎日終日に出る。期限切れにもならない（押すと経過のシート）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(new Date(Date.now() - 2 * 86400_000)), '看板の張り替え', null, null, { progress: 'doing' })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const dt = await openDay(localDateKey())
    const ad = [...dt.querySelectorAll('.dt-ad')].find(x => x.textContent.includes('看板の張り替え'))
    expect(ad.classList.contains('progress')).toBe(true)
    expect(dt.querySelector('.dt-ad.missed')).toBeNull()               // 期限切れにはしない
    await click(ad.querySelector('.dt-ct'))
    expect(document.body.querySelector('.ps')).not.toBeNull()
    await click(document.body.querySelector('.ps-x'))
    // 作る
    await click(host.querySelector('.dt-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const t = form.querySelector('input[aria-label="やること"]')
    t.value = '製氷機の修理'; t.dispatchEvent(new Event('input')); await tick()
    await click(btn('何日かかかる', form))
    expect(form.textContent).not.toContain('次に見る')   // 次に見る日は選ばない（User決定 2026-10-28）
    await click(btn('みんなに見せて追加', form))
    const { saveTaskToD1 } = await import('../composables/useStore.js')
    expect(saveTaskToD1).toHaveBeenLastCalledWith(expect.objectContaining({ text: '製氷機の修理', progress: 'doing', date: localDateKey() }))
    expect(host.querySelector('.dt').textContent).toContain('製氷機の修理')
  })

  it('期限つきのやること: 期限までは今日の終日に「期限 m/d」。過ぎたら期限切れ', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const k = n => localDateKey(new Date(Date.now() + n * 86400_000))
    T.addTask(k(-1), 'パッキン交換', null, null, { deadline: k(2) })
    T.addTask(k(-3), '見積もりの返事', null, null, { deadline: k(-1) })
    expect(T.overdueTasks(k(0)).map(t => t.text)).toEqual(['見積もりの返事'])
    expect(T.carriedTasks(k(0)).map(t => t.text)).toEqual(['パッキン交換'])
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const dt = await openDay(k(0))
    const carry = [...dt.querySelectorAll('.dt-ad')].find(x => x.textContent.includes('パッキン交換'))
    expect(carry.classList.contains('missed')).toBe(false)
    expect(carry.textContent).toContain('期限')
    expect([...dt.querySelectorAll('.dt-ad.missed')].map(x => x.textContent).join()).toContain('見積もりの返事')
  })

  it('メモ: その日のメモを書く（発注の見込みから外す印も）。月のマスに札、タイムラインの終日に出る', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const today = localDateKey()
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await openDay(today)
    await click(host.querySelector('.dt [aria-label="メモ"]'))
    const sheet = document.body.querySelector('.jp-sheet')
    for (const t of ['貸切', 'イベント', 'メニュー変更']) expect([...sheet.querySelectorAll('button')].some(b => b.textContent.trim() === t)).toBe(false)
    const ta = sheet.querySelector('.jp-memo')
    ta.value = '近隣で花火大会'; ta.dispatchEvent(new Event('input')); await tick()
    const ex = sheet.querySelector('.jp-excl input'); ex.checked = true; ex.dispatchEvent(new Event('change')); await tick()
    await click(btn('保存', sheet))
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dayNotes))
    expect(saved[today]).toEqual({ text: '近隣で花火大会', tags: [], excluded: true })
    expect(host.querySelector('.dt-ad.note').textContent).toContain('近隣で花火大会')
    expect(host.querySelector(`.jm-c[aria-label^="${today}"] .tag.plan`).textContent).toBe('近隣で花火大会')
  })

  it('発注スケジュール（発注日の予定）はカレンダーにもタイムラインにも出さない', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { useConfig } = await import('../composables/useConfig.js')
    const k = n => localDateKey(new Date(Date.now() + n * 86400_000))
    useConfig().config.orderSchedules = [{ id: 's1', name: '昼の仕入先', days: [0, 1, 2, 3, 4, 5, 6], deadline: '14:00' }]
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.jm .tag.order')).toBeNull()
    const dt = await openDay(k(1))
    expect(dt.textContent).not.toContain('発注の締切')
  })

  it('月を送ると横に滑る（次の月は slide-next、前の月は slide-prev）', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('[aria-label="次の月"]'))
    expect(host.querySelector('.jm-grid').classList.contains('slide-next')).toBe(true)
    await click(host.querySelector('[aria-label="前の月"]'))
    expect(host.querySelector('.jm-grid').classList.contains('slide-prev')).toBe(true)
  })

  it('備考: 追加のときに書け（＋ 備考）、タイムラインの行に📝で出る。担当の人も書き足せる', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await openDay(localDateKey())
    await click(host.querySelector('.dt-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const text = form.querySelector('input[aria-label="やること"]')
    text.value = '製氷機の点検'; text.dispatchEvent(new Event('input')); await tick()
    await click(btn('備考', form))
    const note = form.querySelector('textarea[aria-label="備考"]')
    note.value = '業者 03-1234-5678'; note.dispatchEvent(new Event('input')); await tick()
    await click(btn('みんなに見せて追加', form))
    const t = T.aliveTasks.value.find(x => x.text === '製氷機の点検')
    expect(t.note).toBe('業者 03-1234-5678')
    const { saveTaskToD1 } = await import('../composables/useStore.js')
    expect(saveTaskToD1).toHaveBeenLastCalledWith(expect.objectContaining({ note: '業者 03-1234-5678' }))
    expect(host.querySelector('.dt .dt-note').textContent).toContain('業者 03-1234-5678')
    // 直す（作った人）: TaskRow の備考
    expect(T.setTaskNote(t.id, '業者に連絡済み')).toBeTruthy()
    expect(T.aliveTasks.value.find(x => x.id === t.id).note).toBe('業者に連絡済み')
  })

  it('ルーティン: 月の🔁から見本で始める。「＋」の「🔁 繰り返す」でも作れる', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('[aria-label="ルーティンの設定"]'))
    const page = document.body.querySelector('.cp')
    await click(btn('見本で始める', page))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenCalledWith(expect.objectContaining({ name: '☀ 開店チェック', repeat: 'daily' }))
    await click(btn('戻る', page))
    const { localDateKey } = await import('../utils/localDate.js')
    const dt = await openDay(localDateKey())
    expect(dt.textContent).toContain('開店チェック')
    await click(host.querySelector('.dt-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const t = form.querySelector('input[aria-label="やること"]')
    t.value = 'ゴミ出し'; t.dispatchEvent(new Event('input')); await tick()
    await click(btn('繰り返す', form))
    await click(btn('毎月', form))
    await click(btn('月末', form))
    expect(form.querySelector('.jp-rep-note').textContent).toContain('毎月1日・月末のルーティン')
    await click(btn('毎日', form))
    await click(btn('ルーティンとして追加', form))
    expect(saveChecklistToD1).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'ゴミ出し', items: [], repeat: 'daily' }))
  })
  it('棚卸の中断が4回を超えたら1行にたたむ（押すと開く）。帯は斜線のまま', async () => {
    const at = hm => new Date(`2026-10-20T${hm}:00`).getTime()
    const ps = [['11:05', '11:20'], ['12:10', '12:30'], ['13:00', '13:02'], ['13:30', '13:50'], ['15:20', '16:02']].map(([f, t]) => ({ from: at(f), to: at(t) }))
    const { buildDayTimeline } = await import('../services/dayTimeline.js')
    const tl = buildDayTimeline({ date: '2026-10-20', today: '2026-10-26', records: [{ key: 's', kind: 'stock', at: at('10:35'), end: at('16:20'), pauses: ps, title: '棚卸 完了 ・ 40品目' }], tasks: [{ id: 'v', text: '野菜の検品', dueTime: '11:10', doneAt: 'x' }] })
    const { default: DayTimeline } = await import('./DayTimeline.vue')
    await mount(DayTimeline, { date: '2026-10-20', today: '2026-10-26', timeline: tl })
    const fold = host.querySelector('.dt-fold')
    expect(fold.textContent).toContain('中断 5回（1時間39分）')
    expect(host.querySelectorAll('.dt-ev.pause')).toHaveLength(0)
    expect([...host.querySelectorAll('.dt-band')].some(b => b.classList.contains('hatch'))).toBe(true)   // 中断中の検品の横は斜線
    expect(host.querySelector('.dt-during').textContent).toBe('棚卸の中断中')
    await click(fold)
    expect(host.querySelectorAll('.dt-ev.pause')).toHaveLength(5)
    expect(host.querySelector('.dt-ev.end').textContent).toContain('合計 5時間45分 ・ 中断5回 1時間39分')
  })
})
