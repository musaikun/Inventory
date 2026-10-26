// 連絡（ホームのトーク・タスク化。User決定 2026-10-26・キャンバス「日誌カレンダー」②〜④）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), saveTaskToD1: vi.fn(async () => true), loadTasksFromD1: vi.fn(async () => []),
  loadHandoffsFromD1: vi.fn(async () => null), addHandoffToD1: vi.fn(async b => ({ ok: true, handoff: { ...b, reads: [], createdAt: new Date().toISOString() } })),
  actHandoffInD1: vi.fn(async () => ({ ok: true })) }))

let app = null, host = null
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = (label, root = document.body) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.textContent.includes(label))
async function mount(comp, props = {}) {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(comp, props) }); app.mount(host); await tick()
}
// その日のその時刻（端末の時刻）
const dayAt = (n, hm) => { const d = new Date(); d.setDate(d.getDate() + n); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString() }
const ago = hrs => new Date(Date.now() - hrs * 3600_000).toISOString()
async function seed(list) {
  const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
  localStorage.setItem(STORAGE_KEYS.handoffs, JSON.stringify(list))
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })

describe('連絡', () => {
  it('ホームのカードに未読の数と新しいメッセージ。押すとトーク（ここから未読の線・日の区切り）', async () => {
    await seed([
      { id: 'h2', kind: 'tell', body: '冷蔵庫の扉のパッキンが浮いてます', by: '佐藤', byId: 'st-s', reads: [], createdAt: dayAt(0, '00:01') },
      { id: 'h1', kind: 'tell', body: 'トマトの入荷が明日に', by: '山田', byId: 'st-y', reads: [], createdAt: dayAt(-1, '12:00') },
    ])
    const { default: HomeTop } = await import('./HomeTop.vue')
    await mount(HomeTop)
    const card = host.querySelector('.ht-talk')
    expect(card.textContent).toContain('未読 2')
    expect(card.querySelectorAll('.ht-talk-m')[0].textContent).toContain('冷蔵庫の扉のパッキンが浮いてます')
    await click(card)
    const tk = document.body.querySelector('.tk')
    expect([...tk.querySelectorAll('.tk-day')].map(x => x.textContent)).toEqual(['昨日', '今日'])
    expect(tk.querySelector('.tk-unread')).not.toBeNull()
    expect([...tk.querySelectorAll('.tk-bub')].map(b => b.textContent)).toEqual(['トマトの入荷が明日に', '冷蔵庫の扉のパッキンが浮いてます'])
  })

  it('書いて送る。押すと［確認］で読んだ人が残り、未読が減る', async () => {
    await seed([{ id: 'h1', kind: 'tell', body: 'トマトの入荷が明日に', by: '山田', byId: 'st-y', reads: [], createdAt: ago(1) }])
    const { default: TalkPage } = await import('./TalkPage.vue')
    const H = await import('../composables/useHandoffs.js')
    await mount(TalkPage)
    const tk = document.body.querySelector('.tk')
    await click(tk.querySelector('.tk-bub'))
    await click(btn('確認', tk))
    const { actHandoffInD1, addHandoffToD1 } = await import('../composables/useStore.js')
    expect(actHandoffInD1).toHaveBeenCalledWith('h1', 'read')
    expect(H.unreadHandoffs.value).toHaveLength(0)
    expect(tk.querySelector('.tk-unread')).toBeNull()
    const ta = tk.querySelector('.tk-in textarea')
    ta.value = '了解です'; ta.dispatchEvent(new Event('input')); await tick()
    await click(tk.querySelector('.tk-in button[type=submit]'))
    expect(addHandoffToD1).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'tell', body: '了解です', by: '高木' }))
    const mine = [...tk.querySelectorAll('.tk-row.mine .tk-bub')].map(b => b.textContent)
    expect(mine).toEqual(['了解です'])
  })

  it('タスク化: 本日中・日付選択・期限選択・進行中にする。決めるボタンは無く、押せば決まる。札が付き、取り消せる', async () => {
    await seed([
      { id: 'a', kind: 'tell', body: 'パッキンが浮いてる', by: '佐藤', byId: 'st-s', reads: [], createdAt: ago(4) },
      { id: 'b', kind: 'tell', body: '見積もりの返事', by: '佐藤', byId: 'st-s', reads: [], createdAt: ago(3) },
      { id: 'c', kind: 'tell', body: '玉ねぎ多め', by: '山田', byId: 'st-y', reads: [], createdAt: ago(2) },
      { id: 'd', kind: 'tell', body: 'エアコンの修理', by: '山田', byId: 'st-y', reads: [], createdAt: ago(1) },
    ])
    const { localDateKey } = await import('../utils/localDate.js')
    const k = n => localDateKey(new Date(Date.now() + n * 86400_000))
    const T = await import('../composables/useTasks.js')
    const A = await import('../composables/useAuth.js')
    const { default: TalkPage } = await import('./TalkPage.vue')
    await mount(TalkPage)
    A.staffNames.value = [{ id: 'st-s', name: '佐藤' }]
    const tk = document.body.querySelector('.tk')
    const task = async (i, act, pick = null, who = null) => {
      await click(tk.querySelectorAll('.tk-bub')[i])
      await click(btn('タスク化', tk))
      const sh = document.body.querySelector('.tts')
      expect(sh.querySelector('h2, b').textContent).toContain('タスク化')
      expect(btn('のやることにする', sh)).toBeUndefined()           // 決めるボタンは無い
      if (who) await click(btn(who, sh))
      await click(btn(act, sh))
      if (pick) await click(btn(pick, sh))
      expect(document.body.querySelector('.tts')).toBeNull()
    }
    await task(0, '本日中', null, '佐藤')
    await task(1, '期限選択', '明日まで')
    await task(2, '日付選択', '明日')
    await task(3, '進行中にする')
    const byText = Object.fromEntries(T.aliveTasks.value.map(t => [t.text, t]))
    expect(byText['パッキンが浮いてる']).toMatchObject({ date: k(0), assign: 'person', assigneeId: 'st-s' })
    expect(byText['見積もりの返事']).toMatchObject({ date: k(0), deadline: k(1) })
    expect(byText['玉ねぎ多め']).toMatchObject({ date: k(1) })
    expect(byText['エアコンの修理']).toMatchObject({ date: k(0), progress: 'doing' })
    const chips = [...tk.querySelectorAll('.tk-chip')].map(c => c.textContent)
    expect(chips[0]).toContain('タスクになりました ・ 佐藤 ・ 今日')
    expect(chips[1]).toContain('期限')
    expect(chips[3]).toContain('進行中')
    const { actHandoffInD1 } = await import('../composables/useStore.js')
    expect(actHandoffInD1).toHaveBeenCalledWith('d', 'task', { taskId: byText['エアコンの修理'].id })
    // 直後は取り消せる
    await click(btn('取り消す', tk))
    expect(T.aliveTasks.value.some(t => t.text === 'エアコンの修理')).toBe(false)
    expect(actHandoffInD1).toHaveBeenLastCalledWith('d', 'task', { taskId: byText['エアコンの修理'].id, clear: true })
    expect(tk.querySelectorAll('.tk-chip')).toHaveLength(3)
  })
})
