// やることを足す、ただ1つの入口（まず種類・チェック表・お気に入り・別の日にコピー。User決定 2026-11-05）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []),
  saveChecklistToD1: vi.fn(async () => ({ ok: true })), markChecklistInD1: vi.fn(async () => ({ ok: true })), loadChecklistsFromD1: vi.fn(async () => null),
  loadTemplatesFromD1: vi.fn(async () => null), saveTemplateToD1: vi.fn(async () => ({ ok: true })),
  loadHandoffsFromD1: vi.fn(async () => null), loadTaskNotesFromD1: vi.fn(async () => []) }))

let app = null, host = null, events
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = (label, root = document.body) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input')); await tick() }
async function mount(comp, props = {}) {
  host = document.createElement('div'); document.body.appendChild(host)
  events = []
  app = createApp({ render: () => h(comp, { ...props, onClose: () => events.push('close'), onAdded: e => events.push(e) }) }); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })
const sheet = () => document.body.querySelector('.ta')

describe('種類から選ぶ追加の画面', () => {
  it('最初は種類だけ。選ぶとその種類に要る欄だけが出る（‹ で選び直せる）', async () => {
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet, { date: '2099-01-02' })
    expect([...sheet().querySelectorAll('.ta-kind b')].map(e => e.textContent)).toEqual(['やること', 'チェック表', 'ルーティン', '進行中', 'いつか'])
    expect(sheet().querySelector('input')).toBeNull()
    await click(sheet().querySelector('.ta-kind[data-kind="someday"]'))
    expect(sheet().querySelector('input[type=date]'), 'いつかに日付は無い').toBeNull()
    await click(sheet().querySelector('.ta-back'))
    await click(sheet().querySelector('.ta-kind[data-kind="task"]'))
    expect(sheet().querySelector('input[type=date]').value).toBe('2099-01-02')
  })

  it('チェック表（1回）: 項目を足して、その日の1回きりの表を作る。項目が無いと足せない', async () => {
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet, { date: '2099-01-02' })
    await click(sheet().querySelector('.ta-kind[data-kind="checklist"]'))
    await type(sheet().querySelector('input[aria-label="チェック表の名前"]'), 'ケータリングの準備')
    expect(btn('追加（0項目）').disabled).toBe(true)
    for (const t of ['保冷バッグ', 'ラベル']) { await type(sheet().querySelector('input[aria-label="項目"]'), t); await click(btn('足す', sheet())) }
    await click(btn('追加（2項目）'))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'ケータリングの準備', repeat: 'none', startDate: '2099-01-02', items: [expect.objectContaining({ text: '保冷バッグ' }), expect.objectContaining({ text: 'ラベル' })],
    }))
    expect(events).toContain('close')
  })

  it('チェック表（繰り返す）: 曜日と時刻（何回でも）を選び、一文で言い直す。お気に入りにも入れられる', async () => {
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet)
    await click(sheet().querySelector('.ta-kind[data-kind="checklist"]'))
    await type(sheet().querySelector('input[aria-label="チェック表の名前"]'), '閉店チェック')
    await type(sheet().querySelector('input[aria-label="項目"]'), 'ガスの元栓'); await click(btn('足す', sheet()))
    await click(btn('繰り返す'))
    await click(btn('曜日'))
    await click(btn('金')); await click(btn('土'))
    const tm = sheet().querySelector('input[aria-label="足す時刻"]'); tm.value = '22:30'; tm.dispatchEvent(new Event('input')); await tick()
    await click(btn('＋ 時刻'))
    expect(sheet().querySelector('.ta-note').textContent).toContain('毎週 金・土 22:30 に、全員が「閉店チェック」（1項目）をする')
    const fav = sheet().querySelector('.ta-fav-chk input'); fav.checked = true; fav.dispatchEvent(new Event('change')); await tick()
    await click(btn('追加（1項目）'))
    const { saveChecklistToD1, saveTemplateToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenLastCalledWith(expect.objectContaining({ name: '閉店チェック', repeat: 'weekly', repeatDays: '5,6', dueTimes: ['22:30'] }))
    expect(saveTemplateToD1).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'checklist', name: '閉店チェック', data: expect.objectContaining({ repeat: 'weekly', repeatDays: '5,6', dueTimes: ['22:30'] }) }))
  })

  it('ルーティンは項目なし（チェック表を案内する）', async () => {
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet)
    await click(sheet().querySelector('.ta-kind[data-kind="routine"]'))
    expect(sheet().querySelector('input[aria-label="項目"]')).toBeNull()
    expect(sheet().textContent).toContain('📋 チェック表 で作ります')
  })

  it('★ お気に入りから選ぶと、種類と中身が入った状態で開く（日付だけ選ぶ）', async () => {
    const { templates } = await import('../composables/useTemplates.js')
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    localStorage.setItem(STORAGE_KEYS.taskTemplates, JSON.stringify([{ id: 'tp1', kind: 'checklist', name: '開店準備', data: { items: [{ id: 'a', text: '看板を出す' }, { id: 'b', text: 'レジを開ける' }], repeat: 'none', dueTimes: ['10:00'] }, sort: 1 }]))
    vi.resetModules()
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet, { date: '2099-03-03' })
    expect(templates).toBeTruthy()
    await click(btn('開店準備'))
    expect(sheet().querySelector('input[aria-label="チェック表の名前"]').value).toBe('開店準備')
    expect([...sheet().querySelectorAll('.ta-items li span')].map(e => e.textContent)).toEqual(['看板を出す', 'レジを開ける'])
    expect(sheet().querySelector('input[type=time]').value).toBe('10:00')
    expect(sheet().querySelector('input[type=date]').value).toBe('2099-03-03')
  })
})

describe('別の日にコピー・お気に入りに入れる（日誌のやること）', () => {
  it('やることを押す → 別の日にコピー → 日を2つ選ぶ → その2日に同じやること', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    T.addTask(today, '揚げ油の交換', null, '15:00', { note: '2缶' })
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector(`.jm-c[aria-label^="${today}"]`))
    const card = [...host.querySelectorAll('.dt-card, .dt-ct')].find(e => e.textContent.includes('揚げ油の交換'))
    await click(card)
    await click(btn('別の日にコピー'))
    const d = new Date(); d.setDate(d.getDate() + 3)
    const d2 = new Date(); d2.setDate(d2.getDate() + 4)
    const pick = async k => {
      let b = document.body.querySelector(`.cd-d[data-day="${k}"]`)
      if (!b) { await click(btn('›', document.body.querySelector('.cd'))); b = document.body.querySelector(`.cd-d[data-day="${k}"]`) }
      await click(b)
    }
    await pick(localDateKey(d)); await pick(localDateKey(d2))
    await click(btn('2日にコピー'))
    const copies = T.aliveTasks.value.filter(t => t.text === '揚げ油の交換').map(t => [t.date, t.dueTime, t.note]).sort()
    expect(copies).toEqual([[today, '15:00', '2缶'], [localDateKey(d), '15:00', '2缶'], [localDateKey(d2), '15:00', '2缶']].sort())
  })
})
