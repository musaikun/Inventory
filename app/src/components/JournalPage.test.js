// 日誌（やること・予定・記録。User決定 2026-10-09）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []), saveMovementToD1: vi.fn(async () => true),
  saveChecklistToD1: vi.fn(async () => ({ ok: true })), markChecklistInD1: vi.fn(async () => ({ ok: true })), loadChecklistsFromD1: vi.fn(async () => null),
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

describe('日誌（お店のカレンダー・2026-10-25）', () => {
  it('開くと週の帯＋今日のリスト。ルーティン○とやること□を時刻の順に1本（期限切れは先頭）。押すとその場で済む', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify({ lists: [
      { id: 'c1', name: '退店チェック', items: [{ id: 'a', text: 'ガスの元栓' }], repeat: 'daily', startDate: '2026-01-01', dueTimes: ['22:00'], assign: 'anyone' },
      { id: 'c2', name: 'ゴミ出し', items: [], repeat: 'daily', startDate: '2026-01-01', dueTimes: [], assign: 'anyone' },
    ], runs: {} }))
    T.addTask(today, '野菜の検品', null, '11:00')
    T.addTask(localDateKey(new Date(Date.now() - 2 * 86400_000)), '油の交換')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelectorAll('.jw-d')).toHaveLength(7)
    expect(host.querySelector('.jw-d.on [class]')).not.toBeNull()
    expect(host.querySelector('.jp-views')).toBeNull()          // リスト／月／1日の切り替えは無い
    expect(host.querySelector('.jp-flt')).toBeNull()            // 今日／進行中／済み／記録のタブも無い
    const names = [...host.querySelectorAll('.jp-box > *')].map(r => r.textContent)
    expect(names[0]).toContain('油の交換')                        // 期限切れが先頭
    expect(names[1]).toContain('野菜の検品')                      // 11:00
    expect(names[2]).toContain('退店チェック')                    // 22:00
    expect(names[3]).toContain('ゴミ出し')                        // 時刻なしは後ろ
    expect(host.querySelector('.jp-sumr').textContent).toContain('0/4')
    // 項目なしのルーティンは○を押せば済む
    await click(host.querySelector('.rw:last-child .rw-ck'))
    const { markChecklistInD1 } = await import('../composables/useStore.js')
    expect(markChecklistInD1).toHaveBeenLastCalledWith('c2', today, expect.objectContaining({ itemId: '_', state: 'done' }))
    expect(host.querySelector('.jp-sumr').textContent).toContain('1/4')
    // 項目のあるものは✓の画面
    await click(host.querySelector('.rw .rw-tx'))
    const run = document.body.querySelector('.cr')
    expect(run.textContent).toContain('ガスの元栓')
    await click(btn('あとで続ける', run))
    expect(document.body.querySelector('.cr')).toBeNull()
  })

  it('週の帯を下に引くと月。日を押すとその日の中身へ（過ぎた日の残りは赤い線）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const d = new Date(); d.setDate(1)
    const first = localDateKey(d)
    T.addTask(first, '月初の掃除')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('.jw-pull'))
    expect(host.querySelector('.jw-mo')).not.toBeNull()
    const cell = host.querySelector(`.jw-c[aria-label="${first}"]`)
    if (first < localDateKey()) expect(cell.querySelector('.st.x')).not.toBeNull()
    await click(cell)
    expect(host.querySelector('.jw-mo')).toBeNull()              // 押したら週に戻る
    expect(host.querySelector('.jp-box').textContent).toContain('月初の掃除')
    expect(host.querySelector('.jp-title b').textContent).toContain(`${d.getMonth() + 1}/1`)
    if (first !== localDateKey()) {
      await click(btn('今日', host.querySelector('.jp-title')))
      expect(host.querySelector('.jp-title b').textContent).not.toContain(`${d.getMonth() + 1}/1（`)
    }
  })

  it('担当者で絞る: すべて・自分・その日に担当がある人・未定（数は残り）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    T.addTask(today, '製氷機フィルター交換', { mode: 'person', id: 'u-sato', name: '佐藤' })
    T.addTask(today, '野菜の検品', { mode: 'none' })
    T.addTask(today, '手洗いの確認')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const chips = [...host.querySelectorAll('.jp-ppl button')].map(b => b.textContent)
    expect(chips).toEqual(['すべて3', '自分0', '佐佐藤1', '未定1'])
    await click(btn('佐藤', host.querySelector('.jp-ppl')))
    expect(host.querySelector('.jp-box').textContent).toContain('製氷機フィルター交換')
    expect(host.querySelector('.jp-box').textContent).not.toContain('手洗いの確認')
    await click(btn('未定', host.querySelector('.jp-ppl')))
    expect(host.querySelectorAll('.jp-box .tr')).toHaveLength(1)
    expect(host.querySelector('.jp-box').textContent).toContain('野菜の検品')
  })

  it('伝票: その日のやり残し・済み・記録（入出庫は続けて入れたものがまとまる）。📤 日報で送る', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const a = T.addTask(localDateKey(), '野菜の検品')
    T.addTask(localDateKey(), '手洗いの確認')
    T.toggleTask(a.id)
    const { useMovements } = await import('../composables/useMovements.js')
    const mv = useMovements()
    mv.saveMovement({ type: 'in', by: '山田', lines: [{ item: 'キャベツ', qty: 6, unit: '玉' }] })
    mv.saveMovement({ type: 'in', by: '山田', lines: [{ item: 'トマト', qty: 24, unit: '個' }] })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.rr')).toBeNull()                 // 記録はリストに混ぜない
    await click(host.querySelector('.jp-sumr'))
    const slip = document.body.querySelector('.ds')
    expect(slip.querySelector('.ds-ring').textContent).toBe('1/2')
    expect(slip.querySelector('.ds-ln.ng').textContent).toContain('手洗いの確認')
    expect(slip.querySelector('.ds-chips').textContent).toContain('野菜の検品 ✓')
    const rows = slip.querySelectorAll('.rr')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('入庫 2品目')
    let shared = ''
    Object.defineProperty(navigator, 'share', { value: async ({ text }) => { shared = text }, configurable: true })
    await click(btn('日報で送る', slip))
    await new Promise(r => setTimeout(r, 0))
    expect(shared).toContain('【日報】')
    expect(shared).toContain('やること 1/2 済み')
    expect(shared).toContain('・手洗いの確認')
    expect(shared).toContain('入庫 2品目')
    delete navigator.share
    await click(btn('時間で見る', slip))
    expect(document.body.querySelector('.ds')).toBeNull()
    expect(host.querySelector('.jd-head')).not.toBeNull()
  })

  it('何もない店は「まだ何もありません」と入口のボタンだけ。何もない日は「☕ 今日はなし」と「これから」', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const nw = host.querySelector('.jp-new')
    expect(nw.textContent).toContain('まだ何もありません')
    expect(nw.querySelectorAll('button')).toHaveLength(2)
    expect(host.querySelector('.jp-fab')).toBeNull()
    app.unmount(); host.remove()
    vi.resetModules()
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(new Date(Date.now() + 2 * 86400_000)), '酒屋の納品')
    const { default: JP2 } = await import('./JournalPage.vue')
    await mount(JP2)
    expect(host.querySelector('.jp-quiet').textContent).toContain('☕ 今日はなし')
    const ahead = host.querySelector('.jp-ahead')
    expect(ahead.textContent).toContain('酒屋の納品')
    await click(ahead.querySelector('button'))
    expect(host.querySelector('.jp-box').textContent).toContain('酒屋の納品')
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
    await click(host.querySelector('[aria-label="時間で見る"]'))
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

  it('1日: 日付を押すと月カレンダーで選べる（その日にあったことのドット）。日別メモもここで', async () => {
    const T = await import('../composables/useTasks.js')
    T.addTask('2026-09-15', '冷蔵庫の点検')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('[aria-label="時間で見る"]'))
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
    expect(host.querySelector('.jp-title b').textContent).toContain('9/15')   // 上の帯も同じ日
    await click(btn('今日へ', host))
    expect(host.querySelector('.jd-date').textContent).toContain('今日')
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
    expect(blocks[0].querySelector('.jd-stock-t').textContent).toContain('合計 5時間45分 ・ 中断5回 1時間39分')
    expect(blocks[0].textContent).not.toContain('実働')
    const ps = blocks[0].querySelectorAll('.jd-pause')
    expect(ps).toHaveLength(5)
    expect(ps[2].textContent).toBe('')                 // 2分の中断は文字なし
    expect(ps[4].textContent).toBe('中断 42分')
  })

  it('管理者は追加のたびに「みんなに見せて追加」「管理者だけで追加」を選ぶ（チェックの付け忘れ・付けすぎを防ぐ・2026-10-19）', async () => {
    const T = await import('../composables/useTasks.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    T.addTask(new Date().toISOString().slice(0, 10), 'x')   // 何もない店の画面にしない
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
    expect(vis).toEqual({ x: null, 面談の準備: 'admins', 冷蔵庫の掃除: null })
  })

  it('いつか: 追加で「いつか」を選ぶと日付なしで、今日のリストの一番下にたたんで出る', async () => {
    const T = await import('../composables/useTasks.js')
    T.addTask(new Date().toISOString().slice(0, 10), 'x')   // 何もない店の画面にしない
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('.jp-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const text = form.querySelector('input[type=text]')
    text.value = 'メニュー表の作り直し'; text.dispatchEvent(new Event('input'))
    const chk = form.querySelector('.jp-chk input')
    chk.checked = true; chk.dispatchEvent(new Event('change')); await tick()
    expect(form.querySelector('input[type=date]')).toBeNull()
    await click(btn('みんなに見せて追加', form))
    expect(T.somedayTasks.value.map(t => t.text)).toEqual(['メニュー表の作り直し'])
    const head = host.querySelector('.jp-someday')
    expect(head.textContent).toContain('いつか')
    expect(host.textContent).not.toContain('メニュー表の作り直し')    // たたんである
    await click(head)
    expect(host.textContent).toContain('メニュー表の作り直し')
  })

  it('ルーティン: 何もない店の「🔁 ルーティン」から見本を押すだけで始まる。リストに○で出る', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(btn('ルーティン', host.querySelector('.jp-new')))
    const page = document.body.querySelector('.cp')
    await click(btn('見本で始める', page))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenCalledWith(expect.objectContaining({ name: '☀ 開店チェック', repeat: 'daily' }))
    await click(btn('戻る', page))
    expect(host.querySelector('.rw').textContent).toContain('開店チェック')
  })

  it('ルーティン: 「＋」の「🔁 繰り返す」で項目なしのルーティンを作れる。○を押せば済み', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(), 'x')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('.jp-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const t = form.querySelector('input[aria-label="やること"]')
    t.value = 'ゴミ出し'; t.dispatchEvent(new Event('input')); await tick()
    await click(btn('繰り返す', form))
    await click(btn('毎月', form))
    await click(btn('月末', form))
    expect(form.querySelector('.jp-rep-note').textContent).toContain('毎月1日・月末のルーティン')
    await click(btn('毎日', form))
    await click(btn('ルーティンとして追加', form))
    const { saveChecklistToD1, markChecklistInD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'ゴミ出し', items: [], repeat: 'daily' }))
    const row = host.querySelector('.rw')
    expect(row.textContent).toContain('ゴミ出し')
    await click(row.querySelector('.rw-ck'))
    expect(markChecklistInD1).toHaveBeenLastCalledWith(expect.any(String), localDateKey(), expect.objectContaining({ itemId: '_', state: 'done' }))
    expect(host.querySelector('.rw.done')).not.toBeNull()
  })

  it('進行中: 「⏳ 何日かかかる」で作る。次に見る日まで今日には出ず期限切れにもならない。「›」で全部（経過を書いて待ちに）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(), 'x')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('.jp-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const t = form.querySelector('input[aria-label="やること"]')
    t.value = '製氷機の修理'; t.dispatchEvent(new Event('input')); await tick()
    await click(btn('何日かかかる', form))
    expect(btn('繰り返す', form)).toBeUndefined()
    await click(btn('3日後', form))
    await click(btn('みんなに見せて追加', form))
    const { saveTaskToD1 } = await import('../composables/useStore.js')
    const plus3 = localDateKey(new Date(Date.now() + 3 * 86400_000))
    expect(saveTaskToD1).toHaveBeenLastCalledWith(expect.objectContaining({ text: '製氷機の修理', progress: 'doing', date: plus3 }))
    expect(host.querySelector('.jp-cards')).toBeNull()
    expect(host.querySelector('.jp-box').textContent).not.toContain('製氷機の修理')
    await click(host.querySelector('.jp-all'))
    const sheet = document.body.querySelector('.jp-progall')
    const card = sheet.querySelector('.pc')
    expect(card.textContent).toContain('製氷機の修理')
    await click(card)
    const ps = document.body.querySelector('.ps')
    const note = ps.querySelector('textarea[aria-label="経過"]')
    note.value = '業者に電話した'; note.dispatchEvent(new Event('input')); await tick()
    await click(btn('待ちにする', ps.querySelector('.ps-compose')))
    await click(btn('送る', ps))
    const { addTaskNoteToD1 } = await import('../composables/useStore.js')
    expect(addTaskNoteToD1).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: '業者に電話した', by: '高木' }))
    expect(T.progressTasks.value[0].progress).toBe('waiting')
  })

  it('進行中: 次に見る日が来たら今日のカードに。過ぎても期限切れにはしない。時間で見るでも ⏳', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(new Date(Date.now() - 2 * 86400_000)), '看板の張り替え', null, null, { progress: 'doing' })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.jp-cards .pc').textContent).toContain('次に見る：過ぎた')
    expect(host.querySelector('.jp-box')?.textContent ?? '').not.toContain('看板の張り替え')
    await click(host.querySelector('[aria-label="時間で見る"]'))
    const chip = host.querySelector('.jd-chip.prog')
    expect(chip.textContent).toContain('⏳ 看板の張り替え')
    await click(chip)
    expect(document.body.querySelector('.ps')).not.toBeNull()
    expect(T.progressTasks.value[0].doneAt).toBeFalsy()
  })
})
