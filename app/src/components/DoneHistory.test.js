// 済んだ業務の履歴（User 2026-11-18）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const remote = vi.hoisted(() => ({ rows: null, calls: [] }))
vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({
  ...(await orig()),
  loadTasksFromD1: vi.fn(async (d) => { remote.calls.push(d); return remote.rows }),
}))

let app = null, events = []
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
const iso = (daysAgo, h = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return d.toISOString() }
const key = daysAgo => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const root = () => document.body.querySelector('.dh')
const items = () => [...root().querySelectorAll('.dh-it')].map(e => e.querySelector('b').textContent)
const pickSel = async (label, v) => { const s = root().querySelector(`select[aria-label="${label}"]`); s.value = v; s.dispatchEvent(new Event('change')); await tick() }
const tab = async label => { [...root().querySelectorAll('.dh-seg button')].find(b => b.textContent === label).click(); await tick() }

async function mount() {
  const { default: View } = await import('./DoneHistory.vue')
  const host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(View, { onOpenProgress: t => events.push(['progress', t.id]), onClose: () => events.push(['close']) }) })
  app.mount(host); await tick()
}
beforeEach(async () => {
  localStorage.clear(); vi.resetModules(); events = []; remote.rows = null; remote.calls = []
  const rows = [
    { id: 'a', date: key(1), text: '仕込み表の確認', doneAt: iso(1), doneBy: '田中', category: 'prep', updatedAt: '1' },
    { id: 'b', date: key(9), text: '換気扇の掃除', doneAt: iso(6), doneBy: '佐藤', category: 'clean', updatedAt: '1' },
    { id: 'c', date: key(40), text: '製氷機の修理', progress: 'doing', deadline: null, doneAt: iso(2), doneBy: '田中', note: '業者 3回目', updatedAt: '1' },
    { id: 'd', date: key(3), text: 'まだのもの', doneAt: null, updatedAt: '1' },
  ]
  localStorage.setItem('inventory_tasks_v1', JSON.stringify(rows))
})
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

describe('DoneHistory', () => {
  it('済んだものを済んだ日ごとに、新しい順で出す。済んでいないものは出さない', async () => {
    await mount()
    expect(items()).toEqual(['仕込み表の確認', '製氷機の修理', '換気扇の掃除'])
    expect(root().querySelector('.dh-sum').textContent).toContain('3件')
    expect(root().querySelector('.dh-sum').textContent).toContain('遅れ 1件')
  })

  it('種類・ジャンル・人・期限・文字で絞れる。「戻す」で全部に戻る', async () => {
    await mount()
    await pickSel('種類', 'progress'); expect(items()).toEqual(['製氷機の修理'])
    await pickSel('種類', '')
    await pickSel('ジャンル', 'clean'); expect(items()).toEqual(['換気扇の掃除'])
    await pickSel('ジャンル', '')
    await pickSel('済ませた人', '田中'); expect(items()).toEqual(['仕込み表の確認', '製氷機の修理'])
    await pickSel('期限', 'late'); expect(items()).toEqual([])
    root().querySelector('.dh-clear').click(); await tick()
    const q = root().querySelector('.dh-q'); q.value = '業者'; q.dispatchEvent(new Event('input')); await tick()
    expect(items()).toEqual(['製氷機の修理'])                // メモでも探せる
  })

  it('1週間に絞ると、それより前に済んだものは出ない', async () => {
    await mount()
    await tab('1週間')
    expect(items()).toEqual(['仕込み表の確認', '製氷機の修理', '換気扇の掃除'])
  })

  it('進行中だったものは押すと経過を開く', async () => {
    await mount()
    root().querySelector('.dh-it[data-id="c"]').click(); await tick()
    expect(events).toEqual([['progress', 'c']])
  })

  it('3か月・1年はサーバーから取り寄せて足す（端末の分と同じものは重ねない）', async () => {
    remote.rows = [
      { id: 'old', date: key(200), text: '去年の大掃除', doneAt: iso(200), doneBy: '佐藤', updatedAt: '1' },
      { id: 'a', date: key(1), text: '仕込み表の確認', doneAt: iso(1), doneBy: '田中', category: 'prep', updatedAt: '1' },
    ]
    await mount()
    await tab('3か月')
    expect(remote.calls).toEqual([])                          // 3か月は端末の分で足りる
    await tab('1年')
    expect(remote.calls).toEqual([365])
    expect(items()).toEqual(['仕込み表の確認', '製氷機の修理', '換気扇の掃除', '去年の大掃除'])
  })

  it('取り寄せに失敗したら、端末にある分だけで出すと伝える', async () => {
    remote.rows = null
    await mount()
    await tab('1年')
    expect(root().querySelector('.dh-note.warn').textContent).toContain('端末にある分だけ')
    expect(items()).toHaveLength(3)
  })
})

describe('ProgressSheet — 済んだもの', () => {
  it('済んだ進行中は「済み」と出し、状態・経過の書き込み・直す・消すを出さない', async () => {
    const { default: Sheet } = await import('./ProgressSheet.vue')
    const host = document.createElement('div'); document.body.appendChild(host)
    const t = { id: 'c', date: key(40), text: '製氷機の修理', progress: 'doing', deadline: null, doneAt: iso(2, 18), doneBy: '田中', createdAt: iso(40), createdBy: 'オーナー', assign: 'anyone', steps: [] }
    app = createApp({ render: () => h(Sheet, { task: t }) }); app.mount(host); await tick()
    const ps = document.body.querySelector('.ps')
    expect(ps.querySelector('.ps-done').textContent).toContain('済み')
    expect(ps.querySelector('.ps-done').textContent).toContain('田中')
    expect(ps.querySelector('.ps-seg')).toBeNull()
    expect(ps.querySelector('textarea[aria-label="経過"]')).toBeNull()
    expect(ps.querySelector('.ps-edit')).toBeNull()
    expect(ps.querySelector('.ps-del')).toBeNull()
    expect(ps.textContent).toContain('未定')
  })
})
