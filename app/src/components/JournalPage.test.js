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
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木'); localStorage.setItem('_journal_view_v1', 'list') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })


// ＋ → 業務を追加（種類は入れた中身で決まる・User決定 2026-11-07）
async function addForm(name = '') {
  await click(host.querySelector('.dt-fab'))
  const form = document.body.querySelector('.ta')
  if (name) { const t = form.querySelector('input[aria-label="名前"]'); t.value = name; t.dispatchEvent(new Event('input')); await tick() }
  return form
}
const row = (form, id) => form.querySelector(`[data-row="${id}"]`)
const kindOf = form => form.querySelector('[data-test="kind"]').textContent
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

  it('日誌を開くと、前に日を開いていても月のカレンダーから。外から「この日」と頼んだときだけその日を開く（2026-11-05）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { default: JournalPage, openJournalDay } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await openDay(localDateKey())
    app.unmount(); host.remove()
    await mount(JournalPage)
    expect(host.querySelector('.dt'), '開き直したら月から').toBeNull()
    app.unmount(); host.remove()
    openJournalDay(localDateKey())
    await mount(JournalPage)
    expect(host.querySelector('.dt')).not.toBeNull()
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

  it('＋ → 日付を外すと「いつか」。今日の終日に出る', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await openDay(localDateKey())
    const form = await addForm('メニュー表の作り直し')
    expect(kindOf(form)).toBe('本日')
    await click(row(form, 'day'))
    await click(btn('日付なし', form))
    expect(kindOf(form)).toBe('いつか')
    await click(form.querySelector('.ta-go'))
    expect(T.somedayTasks.value.map(t => t.text)).toEqual(['メニュー表の作り直し'])
    const ad = [...host.querySelectorAll('.dt-ad')].find(x => x.textContent.includes('メニュー表の作り直し'))
    expect(ad.textContent).toContain('いつか')
  })

  it('管理者は「見せる人」の行で、みんな／管理者だけを選べる（既定はみんな）', async () => {
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    T.addTask(new Date().toISOString().slice(0, 10), 'x')   // 何もない店の画面にしない
    await mount(JournalPage)
    await openDay(new Date().toISOString().slice(0, 10))
    let form = await addForm('面談の準備')
    await click(row(form, 'vis'))
    await click(btn('管理者だけ', form))
    await click(form.querySelector('.ta-go'))
    form = await addForm('冷蔵庫の掃除')
    expect(row(form, 'vis').textContent).toContain('みんな')
    form.dispatchEvent(new Event('submit', { cancelable: true })); await tick()   // Enter でも足せる
    const vis = Object.fromEntries(T.aliveTasks.value.map(t => [t.text, t.visibility ?? null]))
    expect(vis).toEqual({ x: null, 面談の準備: 'admins', 冷蔵庫の掃除: null })
  })

  it('進行中: 締め切りを入れると「m/dまで」の進行中。済むまで毎日終日に出て、期限切れにもならない（押すと経過のシート）', async () => {
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
    const form = await addForm('製氷機の修理')
    await click(row(form, 'deadline'))
    const due = localDateKey(new Date(Date.now() + 3 * 86400_000))
    let cell = form.querySelector(`.ta-cal [data-day="${due}"]`)
    if (!cell) { await click(form.querySelector('[aria-label="次の月"]')); cell = form.querySelector(`.ta-cal [data-day="${due}"]`) }
    await click(cell)
    expect(kindOf(form)).toMatch(/^\d+\/\d+まで$/)
    expect(form.textContent).not.toContain('次に見る')
    await click(form.querySelector('.ta-go'))
    const { saveTaskToD1 } = await import('../composables/useStore.js')
    expect(saveTaskToD1).toHaveBeenLastCalledWith(expect.objectContaining({ text: '製氷機の修理', progress: 'doing', date: localDateKey(), deadline: due }))
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

  it('担当は 全員／人 だけ（誰でも・未定は出さない）。自分が選べなければ全員（User決定 2026-10-28）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { staffNames } = await import('../composables/useAuth.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    staffNames.value = [{ id: 'o1', name: 'オーナー', owner: true }, { id: 's1', name: '佐藤' }]   // 読み込み（ログインなしは空）の後に置く
    await openDay(localDateKey())
    const form = await addForm()
    expect(row(form, 'who').textContent).toContain('全員')
    await click(row(form, 'who'))
    expect([...form.querySelectorAll('.ta-list button span')].map(e => e.textContent)).toEqual(['全員', 'オーナー', '佐藤'])
  })

  it('メモ: 追加のときに書け、タイムラインの行に出る。担当の人も書き足せる', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await openDay(localDateKey())
    const form = await addForm('製氷機の点検')
    const note = form.querySelector('input[aria-label="メモ"]')
    note.value = '業者 03-1234-5678'; note.dispatchEvent(new Event('input')); await tick()
    await click(form.querySelector('.ta-go'))
    const t = T.aliveTasks.value.find(x => x.text === '製氷機の点検')
    expect(t.note).toBe('業者 03-1234-5678')
    const { saveTaskToD1 } = await import('../composables/useStore.js')
    expect(saveTaskToD1).toHaveBeenLastCalledWith(expect.objectContaining({ note: '業者 03-1234-5678' }))
    expect(host.querySelector('.dt .dt-note').textContent).toContain('業者 03-1234-5678')
    expect(T.setTaskNote(t.id, '業者に連絡済み')).toBeTruthy()
    expect(T.aliveTasks.value.find(x => x.id === t.id).note).toBe('業者に連絡済み')
  })

  it('ルーティン: 月の🔁から見本で始める。「＋」で繰り返しを選ぶと繰り返しになる', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('[aria-label="ルーティンの設定"]'))
    const page = document.body.querySelector('.cp')
    await click(btn('見本で始める', page))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenCalledWith(expect.objectContaining({ name: '開店チェック', repeat: 'daily' }))
    await click(btn('戻る', page))
    const { localDateKey } = await import('../utils/localDate.js')
    const dt = await openDay(localDateKey())
    expect(dt.textContent).toContain('開店チェック')
    const form = await addForm('ゴミ出し')
    await click(row(form, 'repeat'))
    await click(btn('毎月', form))
    await click(btn('月末', form))
    expect(row(form, 'repeat').textContent).toContain('月末')
    expect(kindOf(form)).toBe('繰り返し')
    await click(btn('毎日', form))
    await click(form.querySelector('.ta-go'))
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
  it('短い棚卸・中断なしでも「進み方」を出す。6人で数えたら人ごとの入力（いつから・いつまで・何品目）が開ける', async () => {
    const at = hm => new Date(`2026-10-20T${hm}:00`).getTime()
    const names = ['オーナー', '鈴木', '田中', '佐々木', '高橋', '伊藤']
    const audit = names.flatMap((n, k) => Array.from({ length: 3 }, (_, i) => ({ ingredient: `${n}-${i}`, enteredBy: n, timestamp: at(`23:${String(2 + k + i * 6).padStart(2, '0')}`) })))
    const { stockRecords } = await import('../services/journalRecords.js')
    const [rec] = stockRecords([{ id: 'x', startedAt: new Date(at('23:00')).toISOString(), endedAt: new Date(at('23:24')).toISOString() }], () => ({ items: [], auditLog: audit, participants: [] }))
    expect(rec.crew.map(c => c.name)).toEqual(names)
    expect(rec.crew[1]).toMatchObject({ count: 3, from: at('23:03'), to: at('23:15') })
    const { buildDayTimeline } = await import('../services/dayTimeline.js')
    const tl = buildDayTimeline({ date: '2026-10-20', today: '2026-10-26', records: [rec] })
    const { default: DayTimeline } = await import('./DayTimeline.vue')
    await mount(DayTimeline, { date: '2026-10-20', today: '2026-10-26', timeline: tl })
    const fold = host.querySelector('.dt-fold')
    expect(fold.textContent).toContain('進み方 ・ 6人 ・ 中断なし')
    expect(host.querySelectorAll('.dt-ev.join')).toHaveLength(0)
    await click(fold)
    const joins = [...host.querySelectorAll('.dt-ev.join')]
    expect(joins).toHaveLength(6)
    expect(joins[1].textContent).toContain('鈴木 3品目')
    expect(joins[1].textContent).toContain('23:03〜23:15')
  })
  it('1人・中断が少ない棚卸は、これまでどおり開いたまま（人の行も出る）', async () => {
    const at = hm => new Date(`2026-10-20T${hm}:00`).getTime()
    const { buildDayTimeline } = await import('../services/dayTimeline.js')
    const tl = buildDayTimeline({ date: '2026-10-20', today: '2026-10-26', records: [{ key: 's', kind: 'stock', at: at('10:00'), end: at('10:40'), pauses: [{ from: at('10:10'), to: at('10:20') }], crew: [{ name: '高木', from: at('10:01'), to: at('10:39'), count: 30 }], title: '棚卸 完了 ・ 30品目' }] })
    const { default: DayTimeline } = await import('./DayTimeline.vue')
    await mount(DayTimeline, { date: '2026-10-20', today: '2026-10-26', timeline: tl })
    expect(host.querySelector('.dt-fold').textContent).toContain('進み方 ・ 中断 1回（10分）')
    expect(host.querySelectorAll('.dt-ev.pause')).toHaveLength(1)
    expect(host.querySelector('.dt-ev.join').textContent).toContain('高木 30品目')
  })
})
