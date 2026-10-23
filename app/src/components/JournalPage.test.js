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
    await click(btn('今日', host.querySelector('.jp-flt')))
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
  it('ルーティン: 「今日」の上に今日の分をリングの丸で横に1段。押すと全画面で✓・今日はなし。「1日」では時刻の回は時間の帯、時刻なしは上の帯', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const items = [{ id: 'a', text: 'ガスの元栓' }, { id: 'b', text: 'ダスター漂白' }]
    localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify({ lists: [
      { id: 'c1', name: '退店チェック', items, repeat: 'daily', startDate: '2026-01-01', dueTimes: ['22:00'], assign: 'anyone' },
      { id: 'c2', name: '週末の大掃除', items, repeat: 'daily', startDate: '2026-01-01', dueTimes: [], assign: 'anyone' },
      { id: 'c3', name: '冷蔵庫の温度', items, repeat: 'daily', startDate: '2026-01-01', dueTimes: ['00:00', '23:59'], assign: 'anyone' },
    ], runs: {} }))
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const rings = [...host.querySelectorAll('.dc-rings .dc-ring')]
    expect(rings.map(c => c.querySelector('.dc-rn').textContent)).toEqual(['冷蔵庫の温度', '退店チェック', '週末の大掃除'])
    expect(rings[0].querySelector('.dc-rb').textContent).toBe('1日2回')   // 1日に何回も
    expect(rings[1].querySelector('.dc-rb').textContent).toBe('毎日')
    expect(host.querySelector('.jp-sum').textContent).toContain('3 のうち 0 済み')
    await click(rings[1])
    const run = document.body.querySelector('.cr')
    expect(run.textContent).toContain('ガスの元栓')
    expect(run.textContent).toContain('22:00の回')
    await click(run.querySelector('.cr-box'))
    expect(run.querySelector('.cr-li.done').textContent).toContain('高木')
    await click(btn('今日はなし', run))
    const reason = run.querySelector('.cr-pop input')
    reason.value = '漂白剤切れ'; reason.dispatchEvent(new Event('input')); await tick()
    await click(btn('今日はなしにする', run))
    expect(run.querySelector('.cr-li.skip').textContent).toContain('漂白剤切れ')
    expect(run.querySelector('.cr-msg').textContent).toContain('済みました')
    const { markChecklistInD1 } = await import('../composables/useStore.js')
    expect(markChecklistInD1).toHaveBeenLastCalledWith('c1', localDateKey(), expect.objectContaining({ slot: '22:00', itemId: 'b', state: 'skip', reason: '漂白剤切れ' }))
    await click(btn('閉じる', run))
    // 「今日はなし」も済み。済んだ丸は緑で後ろへ
    const after = [...host.querySelectorAll('.dc-rings .dc-ring')]
    expect(after[2].classList.contains('ok')).toBe(true)
    expect(after[2].textContent).toContain('退店チェック')
    expect(host.querySelector('.dc-lh em').textContent).toContain('1 / 3')
    expect(host.querySelector('.jp-sum').textContent).toContain('3 のうち 1 済み')
    // すべて: 格子のシート（内訳・記録へ）
    await click(host.querySelector('.dc-all'))
    const sheet = document.body.querySelector('.dc-sheet')
    expect(sheet.querySelectorAll('.dc-grid .dc-ring')).toHaveLength(3)
    expect(sheet.textContent).toContain('毎日 3')
    await click(btn('記録を見る', sheet))
    const rec = document.body.querySelector('.rtr')
    expect(rec.querySelectorAll('.rtr-row')).toHaveLength(3)
    await click(rec.querySelector('.rtr-row'))
    expect(rec.querySelectorAll('.rtr-cal .d').length).toBeGreaterThanOrEqual(28)
    await click(btn('戻る', rec)); await click(btn('戻る', document.body.querySelector('.rtr')))
    expect(document.body.querySelector('.rtr')).toBeNull()
    // 1日
    await click(btn('1日', host.querySelector('.jp-views')))
    expect(host.querySelector('.jd-sum').textContent).toContain('ルーティン 1/3')
    expect(host.querySelector('.jd-band .jd-chip.list').textContent).toContain('週末の大掃除')
    const evs = [...host.querySelectorAll('.jd-ev.list')].map(e => e.textContent)
    expect(evs.filter(t => t.includes('冷蔵庫の温度'))).toHaveLength(2)
    expect(evs.find(t => t.includes('退店チェック'))).toContain('2/2')
  })

  it('ルーティン: まだ無い店の管理者には「作りましょう」。見本を押すだけで始まる', async () => {
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    const first = host.querySelector('.dc-first')
    expect(first.textContent).toContain('ルーティンを作りましょう')
    await click(btn('これで始める', first))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenCalledWith(expect.objectContaining({ name: '☀ 開店チェック', repeat: 'daily', dueTimes: [] }))
    expect(host.querySelector('.dc-first')).toBeNull()
    expect(host.querySelector('.dc-ring').textContent).toContain('開店チェック')
  })

  it('ルーティン: ×で消すと入口の1行になり「ここからいつでも作れます」。消したことは覚える', async () => {
    vi.useFakeTimers()
    try {
      const { default: JournalPage } = await import('./JournalPage.vue')
      await mount(JournalPage)
      await click(host.querySelector('.dc-x'))
      expect(host.querySelector('.dc-first.leaving')).not.toBeNull()
      vi.advanceTimersByTime(500); await tick()
      expect(host.querySelector('.dc-first')).toBeNull()
      expect(host.querySelector('.dc-entry.glow').textContent).toContain('＋ 作る')
      expect(host.querySelector('.dc-toast').textContent).toContain('ここからいつでも作れます')
      vi.advanceTimersByTime(3000); await tick()
      expect(host.querySelector('.dc-toast')).toBeNull()
      const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
      expect(localStorage.getItem(STORAGE_KEYS.hints)).toContain('daily-check-intro')
      // 入口から作る
      await click(host.querySelector('.dc-entry'))
      const page = document.body.querySelector('.cp')
      await click(btn('自分で作る', page))
      const name = page.querySelector('input[type="text"]')
      name.value = '冷蔵庫の温度'; name.dispatchEvent(new Event('input')); await tick()
      expect(page.textContent).toContain('なし ＝ 押せば済む1件')   // 項目は任意
      await click(btn('項目を足す', page))
      const item = page.querySelector('.cp-it input')
      item.value = '冷蔵庫'; item.dispatchEvent(new Event('input')); await tick()
      for (const t of ['15:00', '10:00']) {
        const ti = page.querySelector('input[aria-label="足す時刻"]')
        ti.value = t; ti.dispatchEvent(new Event('input')); await tick()
        await click(btn('時刻を足す', page))
      }
      expect(page.querySelector('.cp-sentence').textContent).toContain('毎日 10:00・15:00（1日2回）に')
      await click(btn('保存', page))
      const { saveChecklistToD1 } = await import('../composables/useStore.js')
      expect(saveChecklistToD1).toHaveBeenCalledWith(expect.objectContaining({ name: '冷蔵庫の温度', dueTimes: ['10:00', '15:00'] }))
    } finally { vi.useRealTimers() }
  })
  it('ルーティン: 「＋」の「🔁 繰り返す」で項目なしのルーティンを作れる。丸を押せば済み（緑）', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
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
    expect(document.body.querySelector('.jp-sheet')).toBeNull()
    const ring = host.querySelector('.dc-ring')
    expect(ring.textContent).toContain('ゴミ出し')
    expect(ring.querySelector('.dc-rb').textContent).toBe('毎日')
    await click(ring)
    expect(markChecklistInD1).toHaveBeenLastCalledWith(expect.any(String), localDateKey(), expect.objectContaining({ itemId: '_', state: 'done' }))
    expect(host.querySelector('.dc-ring').classList.contains('ok')).toBe(true)
    expect(host.querySelector('.dc-lh em').textContent).toContain('1 / 1')
  })

  it('進行中: 「＋」の「⏳ 何日かかかる」で作る。次に見る日まで「今日」には出ず、期限切れにもならない。「進行中」タブに縦のカード', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector('.jp-fab'))
    const form = document.body.querySelector('.jp-sheet')
    const t = form.querySelector('input[aria-label="やること"]')
    t.value = '製氷機の修理'; t.dispatchEvent(new Event('input')); await tick()
    await click(btn('何日かかかる', form))
    expect(form.querySelector('input[aria-label="次に見る日"]')).not.toBeNull()
    expect(btn('繰り返す', form)).toBeUndefined()
    await click(btn('3日後', form))
    await click(btn('みんなに見せて追加', form))
    const { saveTaskToD1 } = await import('../composables/useStore.js')
    const plus3 = localDateKey(new Date(Date.now() + 3 * 86400_000))
    expect(saveTaskToD1).toHaveBeenLastCalledWith(expect.objectContaining({ text: '製氷機の修理', progress: 'doing', date: plus3 }))
    // 今日: 次に見る日はまだ → カードは出ない（「今日見るものはなし」）
    expect(host.querySelector('.jp-cards')).toBeNull()
    expect(host.querySelector('.jp-lh2').textContent).toContain('今日見るものはなし')
    expect(host.querySelector('.jp-lh.late')).toBeNull()
    await click(btn('すべて 1', host))
    const card = host.querySelector('.jp-vcards .pc')
    expect(card.textContent).toContain('製氷機の修理')
    expect(card.textContent).toContain('進行中')
    // 押すと経過のシート。経過を書いて「待ち」にする
    await click(card)
    const ps = document.body.querySelector('.ps')
    const note = ps.querySelector('textarea[aria-label="経過"]')
    note.value = '業者に電話した'; note.dispatchEvent(new Event('input')); await tick()
    await click(btn('待ちにする', ps.querySelector('.ps-compose')))
    await click(btn('送る', ps))
    const { addTaskNoteToD1 } = await import('../composables/useStore.js')
    expect(addTaskNoteToD1).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: '業者に電話した', by: '高木' }))
    expect(ps.querySelector('.ps-tl').textContent).toContain('業者に電話した')
    await click(ps.querySelector('.ps-x'))
    await click(btn('待ち', host.querySelector('.jp-seg')))
    const w = host.querySelector('.jp-vcards .pc.wait')
    expect(w.textContent).toContain('製氷機の修理')
    expect(w.querySelector('.pc-last').textContent).toContain('業者に電話した')
  })

  it('進行中: 次に見る日が来たら「今日」の横のカードに。過ぎても期限切れにはしない', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask(localDateKey(new Date(Date.now() - 2 * 86400_000)), '看板の張り替え', null, null, { progress: 'doing' })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    expect(host.querySelector('.jp-lh.late')).toBeNull()
    expect(host.querySelector('.jp-cards .pc').textContent).toContain('次に見る：過ぎた')
    expect(host.querySelector('.jp-lh2').textContent).toContain('今日見る 1')
    // 1日: 上の帯に ⏳。押すとシート（完了にはならない）
    await click(btn('1日', host.querySelector('.jp-views')))
    const chip = host.querySelector('.jd-chip.prog')
    expect(chip.textContent).toContain('⏳ 看板の張り替え')
    await click(chip)
    expect(document.body.querySelector('.ps')).not.toBeNull()
    expect(T.progressTasks.value[0].doneAt).toBeFalsy()
  })
})
