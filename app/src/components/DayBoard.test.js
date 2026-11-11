// 日誌の予定ボード（予約台帳の形・User決定 2026-11-05）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, events
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick() }
const ROW_H = 68, HOUR = 96, START = 7   // 見せる時間帯の設定が無ければ 8〜24時（前後1時間を足して 7時から）
const xAt = hm => { const [hh, mm] = hm.split(':').map(Number); return ((hh * 60 + mm) / 60 - START) * HOUR }
const yAt = row => 22 + row * ROW_H + ROW_H / 2
function ptr(el, type, x, y) { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })) }

async function mount(timeline) {
  const { default: Board } = await import('./DayBoard.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  events = []
  app = createApp({ render: () => h(Board, {
    date: '2099-01-02', today: '2099-01-01', timeline, canAdd: true,
    onOpen: x => events.push(['open', x.key]), onAddAt: p => events.push(['add-at', p]), onMove: (t, p) => events.push(['move', t.id, p]), onPlace: (x, p) => events.push(['place', x.key, p]),
  }) })
  app.mount(host); await tick()
}
beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  const { staffNames } = await import('../composables/useAuth.js')
  staffNames.value = [{ id: 'o1', name: 'オーナー', owner: true }, { id: 's1', name: '佐藤' }]
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })

async function timelineWith(tasks, extra = {}) {
  const { buildDayTimeline } = await import('../services/dayTimeline.js')
  return buildDayTimeline({ date: '2099-01-02', today: '2099-01-01', tasks, ...extra })
}
const task = (o = {}) => ({ id: 't1', text: 'ランチの仕込み', date: '2099-01-02', dueTime: '09:00', endTime: '10:30', category: 'prep', assign: 'person', assigneeId: 's1', assigneeName: '佐藤', createdById: 'x', ...o })

describe('予定ボード', () => {
  it('行は 全員＋人。やることは担当の行に、始まり〜終わりの帯で（種類の色）', async () => {
    await mount(await timelineWith([task(), task({ id: 't2', text: '野菜の発注', dueTime: '10:00', endTime: null, category: 'order', assign: 'all', assigneeId: null })]))
    expect([...host.querySelectorAll('.db-r')].map(e => e.textContent.replace(/\s/g, ''))).toEqual(['全員', 'オオーナー', '佐佐藤'])   // 名前の下の小さな字は重ねない（全員 みんな／オーナー オーナー・User 2026-11-11）
    const b = host.querySelector('[data-block="t1"]')
    expect(b.classList.contains('k-prep')).toBe(true)
    expect(b.style.top).toBe(`${2 * ROW_H + 7}px`)
    expect(b.style.left).toBe(`${xAt('09:00')}px`)
    expect(b.style.width).toBe(`${xAt('10:30') - xAt('09:00')}px`)
    const pin = host.querySelector('[data-block="t2"]')
    expect(pin.classList.contains('pin')).toBe(true)
    expect(pin.textContent).toContain('10:00までに')
  })

  it('空いているマスを押すと、その時間（30分ごと）・その人で足す', async () => {
    await mount(await timelineWith([]))
    const canvas = host.querySelector('.db-canvas')
    ptr(canvas, 'pointerdown', xAt('14:40'), yAt(2)); ptr(canvas, 'pointerup', xAt('14:40'), yAt(2)); await tick()
    expect(events).toContainEqual(['add-at', { row: 's1', start: '14:30' }])
  })

  it('掴んで横へ＝時間（15分ごと）、縦へ＝担当。右の端を引く＝終わり', async () => {
    const { isAdmin } = await import('../composables/useAuth.js')
    expect(isAdmin.value, '見本は管理者（直せる）').toBe(true)
    await mount(await timelineWith([task()]))
    const b = host.querySelector('[data-block="t1"]')
    const x0 = xAt('09:20'), y0 = yAt(2)
    ptr(b, 'pointerdown', x0, y0)
    ptr(b, 'pointermove', x0 + HOUR, y0 - ROW_H * 2)   // 1時間あと・全員の行へ
    await tick()
    expect(host.querySelector('.db-tip').textContent).toContain('10:00〜11:30 ・ 全員')
    ptr(b, 'pointerup', x0 + HOUR, y0 - ROW_H * 2); await tick()
    expect(events).toContainEqual(['move', 't1', { start: '10:00', end: '11:30', row: 'all' }])
    const grip = host.querySelector('[data-block="t1"] .db-grip')
    ptr(grip, 'pointerdown', xAt('10:30'), y0)
    ptr(grip, 'pointermove', xAt('10:30') + HOUR / 2, y0)
    ptr(grip, 'pointerup', xAt('10:30') + HOUR / 2, y0); await tick()
    expect(events).toContainEqual(['move', 't1', { start: '09:00', end: '11:00', row: 's1' }])
  })

  it('押すだけなら中身を開く。ルーティン・記録は動かない', async () => {
    await mount(await timelineWith([task()]))
    const b = host.querySelector('[data-block="t1"]')
    ptr(b, 'pointerdown', xAt('09:20'), yAt(2)); ptr(b, 'pointerup', xAt('09:20'), yAt(2)); await tick()
    expect(events).toContainEqual(['open', 't1'])
  })

  it('いつかの箱から選んで、マスを押すとそこに置く', async () => {
    await mount(await timelineWith([], { someday: [{ id: 's9', text: '倉庫の棚の整理', date: '', assign: 'anyone' }] }))
    host.querySelector('.db-box').click(); await tick()
    ;[...host.querySelectorAll('.db-boxlist button')].find(x => x.textContent.includes('倉庫の棚の整理')).click(); await tick()
    expect(host.querySelector('.db-placing').textContent).toContain('置くマスを押してください')
    const canvas = host.querySelector('.db-canvas')
    ptr(canvas, 'pointerdown', xAt('16:05'), yAt(0)); ptr(canvas, 'pointerup', xAt('16:05'), yAt(0)); await tick()
    expect(events).toContainEqual(['place', 's9', { row: 'all', start: '16:00' }])
    expect(host.querySelector('.db-placing')).toBeNull()
  })

  it('進行中は上の段（たためる）、時刻のないものは「終日」', async () => {
    await mount(await timelineWith([task({ id: 't3', text: '看板を拭く', dueTime: null, endTime: null })], { progress: [{ id: 'p1', text: '製氷機の修理', progress: 'doing', assign: 'anyone' }] }))
    expect(host.querySelector('.db-all').textContent).toContain('看板を拭く')
    expect(host.querySelector('.db-lane').textContent).toContain('製氷機の修理')
    host.querySelector('.db-lane-h').click(); await tick()
    expect(host.querySelector('.db-pbar')).toBeNull()
  })
})
