// 業務を追加（種類は入れた中身で決まる・チェック表は別の入口で作って付ける・子タスク・いつか→始める。User決定 2026-11-07）
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
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木'); localStorage.setItem('_journal_view_v1', 'list') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })
const sheet = () => document.body.querySelector('.ta')

const row = id => sheet().querySelector(`[data-row="${id}"]`)
const kindOf = () => sheet().querySelector('[data-test="kind"]').textContent
async function pickCal(k) {
  let c = sheet().querySelector(`.ta-cal [data-day="${k}"]`)
  if (!c) { await click(sheet().querySelector('[aria-label="次の月"]')); c = sheet().querySelector(`.ta-cal [data-day="${k}"]`) }
  await click(c)
}
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d }
async function seedTemplates(list) {
  const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
  localStorage.setItem(STORAGE_KEYS.taskTemplates, JSON.stringify(list))
  vi.resetModules()
}

describe('業務を追加（種類は選ばない）', () => {
  it('入れた中身で種類が変わる: 本日 → 予定 → m/dまで → いつか、繰り返し。説明の文は出さない', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet)
    expect(kindOf()).toBe('本日')
    expect(sheet().querySelector('.ta-kinds, .ta-note')).toBeNull()
    await click(row('day')); await pickCal(localDateKey(plus(2)))
    expect(kindOf()).toBe('予定')
    await click(row('deadline')); await pickCal(localDateKey(plus(5)))
    expect(kindOf()).toBe(`${plus(5).getMonth() + 1}/${plus(5).getDate()}まで`)
    expect(row('repeat')).toBeNull()                    // 締め切りがあると繰り返しは出さない
    await click(row('deadline')); await click(btn('締め切りを外す', sheet()))
    await click(row('repeat')); await click(btn('毎週', sheet()))
    expect(kindOf()).toBe('繰り返し')
    expect(row('deadline')).toBeNull()
    await click(btn('しない', sheet()))
    await click(row('day')); await click(btn('日付なし', sheet()))
    expect(kindOf()).toBe('いつか')
    // 日付なしでも締め切りだけ入れられる → 今日から進行中（User決定 2026-11-07）
    await click(row('deadline')); await pickCal(localDateKey(plus(3)))
    expect(kindOf()).toBe(`${plus(3).getMonth() + 1}/${plus(3).getDate()}まで`)
    await type(sheet().querySelector('input[aria-label="名前"]'), '備品の確認')
    await click(sheet().querySelector('.ta-go'))
    const T = await import('../composables/useTasks.js')
    expect(T.aliveTasks.value.find(x => x.text === '備品の確認')).toMatchObject({ progress: 'doing', date: localDateKey(), deadline: localDateKey(plus(3)) })
  })

  it('チェック表を付けた予定は、その日の1回きりのチェック表になる', async () => {
    await seedTemplates([{ id: 'tp1', kind: 'checklist', name: '開店準備', data: { items: [{ id: 'a', text: '看板を出す' }, { id: 'b', text: 'レジを開ける' }] }, sort: 1 }])
    const { localDateKey } = await import('../utils/localDate.js')
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet)
    await type(sheet().querySelector('input[aria-label="名前"]'), '開店準備（貸切）')
    await click(row('day')); await pickCal(localDateKey(plus(3)))
    await click(row('list')); await click(btn('開店準備', sheet()))
    expect([...sheet().querySelectorAll('.ta-items li')].map(e => e.textContent)).toEqual(['看板を出す', 'レジを開ける'])
    await click(sheet().querySelector('.ta-go'))
    const { saveChecklistToD1 } = await import('../composables/useStore.js')
    expect(saveChecklistToD1).toHaveBeenLastCalledWith(expect.objectContaining({ name: '開店準備（貸切）', repeat: 'none', startDate: localDateKey(plus(3)), items: [expect.objectContaining({ text: '看板を出す' }), expect.objectContaining({ text: 'レジを開ける' })] }))
  })

  it('締め切りとチェック表 → 進行中のやることに子タスクとして付く', async () => {
    await seedTemplates([{ id: 'tp1', kind: 'checklist', name: '修理の手配', data: { items: [{ id: 'a', text: '業者に連絡' }, { id: 'b', text: '見積もり' }] }, sort: 1 }])
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet)
    await type(sheet().querySelector('input[aria-label="名前"]'), '製氷機の修理')
    await click(row('deadline')); await pickCal(localDateKey(plus(4)))
    await click(row('list')); await click(btn('修理の手配', sheet()))
    await click(sheet().querySelector('.ta-go'))
    const t = T.aliveTasks.value.find(x => x.text === '製氷機の修理')
    expect(t).toMatchObject({ progress: 'doing', deadline: localDateKey(plus(4)) })
    expect(t.steps.map(x => [x.text, x.done])).toEqual([['業者に連絡', false], ['見積もり', false]])
  })

  it('★ お気に入りから開くと中身が入っている（繰り返しのもの）', async () => {
    const { default: Sheet } = await import('./TaskAddSheet.vue')
    await mount(Sheet, { template: { id: 'tp', kind: 'routine', name: 'ゴミ出し', data: { repeat: 'weekly', repeatDays: '1,4', dueTimes: ['22:00'] } } })
    expect(sheet().querySelector('input[aria-label="名前"]').value).toBe('ゴミ出し')
    expect(kindOf()).toBe('繰り返し')
    expect(row('repeat').textContent).toContain('毎週 月・木')
    expect(row('time').textContent).toContain('22:00')
  })
})

describe('チェック表（別の入口）・子タスク・いつか→始める', () => {
  it('チェック表を作り、「このチェック表で業務を追加」で付けて開く', async () => {
    const { default: Journal } = await import('./JournalPage.vue')
    await mount(Journal)
    await click(host.querySelector('[aria-label="チェック表"]'))
    const page = document.body.querySelector('.ct')
    await click(btn('チェック表を作る', page))
    const sh = document.body.querySelector('.ct-sh')
    await type(sh.querySelector('input[aria-label="チェック表の名前"]'), '閉店チェック')
    for (const x of ['ガスの元栓', '戸締まり']) { await type(sh.querySelector('input[aria-label="項目"]'), x); await click(sh.querySelector('[aria-label="項目を足す"]')) }
    await click(btn('このチェック表で業務を追加', sh))
    const { saveTemplateToD1 } = await import('../composables/useStore.js')
    expect(saveTemplateToD1).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'checklist', name: '閉店チェック', data: { items: [expect.objectContaining({ text: 'ガスの元栓' }), expect.objectContaining({ text: '戸締まり' })] } }))
    expect(row('list').textContent).toContain('閉店チェック')
    expect([...sheet().querySelectorAll('.ta-items li')].map(e => e.textContent)).toEqual(['ガスの元栓', '戸締まり'])
  })

  it('いつかのやることを開くと子タスクを足せ、「始める」で今日から進行中になる', async () => {
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    T.addTask('', '換気扇の掃除')
    const { default: Journal } = await import('./JournalPage.vue')
    await mount(Journal)
    await click(host.querySelector(`.jm-c[aria-label^="${localDateKey()}"]`))
    const ad = [...host.querySelectorAll('.dt-ad')].find(x => x.textContent.includes('換気扇の掃除'))
    await click(ad.querySelector('.dt-ct') || ad)
    const sh = document.body.querySelector('.jp-sheet')
    await type(sh.querySelector('input[aria-label="子タスク"]'), '業者に聞く')
    await click(sh.querySelector('[aria-label="子タスクを足す"]'))
    expect(T.aliveTasks.value.find(x => x.text === '換気扇の掃除').steps.map(x => x.text)).toEqual(['業者に聞く'])
    await click(btn('業者に聞く', sh))
    expect(T.aliveTasks.value.find(x => x.text === '換気扇の掃除').steps[0].done).toBe(true)
    await click(btn('始める', sh))
    expect(T.aliveTasks.value.find(x => x.text === '換気扇の掃除')).toMatchObject({ progress: 'doing', date: localDateKey() })
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

describe('予定ボードから（日誌・2026-11-05）', () => {
  const ptr = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
  const xAt = hm => { const [hh, mm] = hm.split(':').map(Number); return ((hh * 60 + mm) / 60 - 7) * 96 }
  it('マスを押すと追加の画面がその時間・30分で開き、終わりも保存する。掴んでずらすと時間が変わる', async () => {
    localStorage.setItem('_journal_view_v1', 'board')
    const { localDateKey } = await import('../utils/localDate.js')
    const T = await import('../composables/useTasks.js')
    const today = localDateKey()
    const { default: JournalPage } = await import('./JournalPage.vue')
    await mount(JournalPage)
    await click(host.querySelector(`.jm-c[aria-label^="${today}"]`))
    const canvas = host.querySelector('.db-canvas')
    ptr(canvas, 'pointerdown', xAt('15:10'), 22 + 34); ptr(canvas, 'pointerup', xAt('15:10'), 22 + 34); await tick()
    expect(sheet().querySelector('[data-row="time"]').textContent).toContain('15:00〜15:30')
    await type(sheet().querySelector('input[aria-label="名前"]'), '揚げ油の交換')
    await click(sheet().querySelector('.ta-go'))
    const t = T.aliveTasks.value.find(x => x.text === '揚げ油の交換')
    expect(t).toMatchObject({ date: today, dueTime: '15:00', endTime: '15:30' })
    const b = host.querySelector(`[data-block="${t.id}"]`)
    ptr(b, 'pointerdown', xAt('15:10'), 22 + 34); ptr(b, 'pointermove', xAt('15:10') + 48, 22 + 34); ptr(b, 'pointerup', xAt('15:10') + 48, 22 + 34); await tick()
    expect(T.aliveTasks.value.find(x => x.id === t.id)).toMatchObject({ dueTime: '15:30', endTime: '16:00' })
  })
})
