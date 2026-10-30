// ボード（以前の「連絡」。貼り紙・タスク化・はがす。User決定 2026-10-27・キャンバス「日誌カレンダー」⑫⑬）
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
const board = () => document.body.querySelector('.bd')
const note = text => [...board().querySelectorAll('.bd-n')].find(n => n.textContent.includes(text))
const sheet = () => document.body.querySelector('.bd-sh')

describe('ボード', () => {
  it('ホームのカードに新しい数と貼り紙2枚。押すとボード（新しいものが左上・まだ見ていないものは光る）', async () => {
    await seed([
      { id: 'h2', kind: 'tell', body: '冷蔵庫の扉のパッキンが浮いてます', by: '佐藤', byId: 'st-s', reads: [], createdAt: ago(1) },
      { id: 'h1', kind: 'tell', body: 'トマトの入荷が明日に', by: '山田', byId: 'st-y', reads: [{ id: 'x', name: '高木' }], createdAt: ago(20) },
    ])
    const { default: HomeTop } = await import('./HomeTop.vue')
    await mount(HomeTop)
    const card = host.querySelector('.ht-bd-card')
    expect(card.textContent).toContain('新しい 2')
    expect(card.querySelectorAll('.ht-bdc-n')).toHaveLength(2)
    expect(card.querySelector('.ht-bdc-n').textContent).toContain('冷蔵庫の扉のパッキンが浮いてます')
    await click(card)
    const ns = [...board().querySelectorAll('.bd-n')]
    expect(ns.map(n => n.querySelector('.bd-n-b').textContent)).toEqual(['冷蔵庫の扉のパッキンが浮いてます', 'トマトの入荷が明日に'])
    expect(ns[0].classList.contains('fresh')).toBe(true)
  })

  it('貼る。開くと「見た」になり、見た人とまだの人が出る', async () => {
    await seed([{ id: 'h1', kind: 'tell', body: 'トマトの入荷が明日に', by: '山田', byId: 'st-y', reads: [{ id: 'st-s', name: '佐藤', at: ago(1) }], createdAt: ago(2) }])
    const A = await import('../composables/useAuth.js')
    const H = await import('../composables/useHandoffs.js')
    const { default: BoardPage } = await import('./BoardPage.vue')
    await mount(BoardPage)
    A.staffNames.value = [{ id: 'st-y', name: '山田' }, { id: 'st-s', name: '佐藤' }, { id: 'st-k', name: '鈴木' }]
    await click(note('トマト'))
    const { actHandoffInD1, addHandoffToD1 } = await import('../composables/useStore.js')
    expect(actHandoffInD1).toHaveBeenCalledWith('h1', 'read')
    expect(H.unreadHandoffs.value).toHaveLength(0)
    expect(sheet().querySelector('.bd-seen').textContent).toContain('見た：佐藤・高木')
    expect(sheet().querySelector('.bd-seen').textContent).toContain('まだ：鈴木')   // 書いた山田は入れない
    await click(sheet().querySelector('[aria-label="閉じる"]'))
    await click(btn('貼る', board()))
    const ta = document.body.querySelector('.bd-sh textarea')
    ta.value = '製氷機の音が大きい'; ta.dispatchEvent(new Event('input')); await tick()
    await click(document.body.querySelector('.bd-post'))
    expect(addHandoffToD1).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'tell', body: '製氷機の音が大きい', by: '高木' }))
    expect(note('製氷機の音が大きい')).toBeTruthy()
  })

  it('タスク化: 本日中・日付選択・期限選択・進行中にする。「✓ タスクにした」が付き、取り消せる。終わったら外れる', async () => {
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
    const { default: BoardPage } = await import('./BoardPage.vue')
    await mount(BoardPage)
    A.staffNames.value = [{ id: 'st-s', name: '佐藤' }]
    const task = async (text, act, pick = null, who = null) => {
      await click(note(text))
      await click(btn('タスク化', sheet()))
      const sh = document.body.querySelector('.tts')
      if (who) await click(btn(who, sh))
      await click(btn(act, sh))
      if (pick) await click(btn(pick, sh))
      expect(document.body.querySelector('.tts')).toBeNull()
      expect(sheet()).toBeNull()
    }
    await task('パッキン', '本日中', null, '佐藤')
    await task('見積もり', '期限選択', '明日まで')
    await task('玉ねぎ', '日付選択', '明日')
    await task('エアコン', '進行中にする')
    const byText = Object.fromEntries(T.aliveTasks.value.map(t => [t.text, t]))
    expect(byText['パッキンが浮いてる']).toMatchObject({ date: k(0), assign: 'person', assigneeId: 'st-s' })
    expect(byText['見積もりの返事']).toMatchObject({ date: k(0), deadline: k(1) })
    expect(byText['玉ねぎ多め']).toMatchObject({ date: k(1) })
    expect(byText['エアコンの修理']).toMatchObject({ date: k(0), progress: 'doing' })
    expect(note('エアコン').querySelector('.bd-n-t')).not.toBeNull()
    await click(note('パッキン'))
    expect(sheet().textContent).toContain('タスクにした（佐藤 ・ 今日）')
    expect(btn('タスク化', sheet())).toBeUndefined()
    await click(sheet().querySelector('[aria-label="閉じる"]'))
    // 直後は取り消せる
    const { actHandoffInD1 } = await import('../composables/useStore.js')
    await click(btn('元に戻す', board()))
    expect(T.aliveTasks.value.some(t => t.text === 'エアコンの修理')).toBe(false)
    expect(actHandoffInD1).toHaveBeenLastCalledWith('d', 'task', { taskId: byText['エアコンの修理'].id, clear: true })
    // タスクが終わったらボードから外れる
    T.toggleTask(byText['玉ねぎ多め'].id); await tick()
    expect(note('玉ねぎ')).toBeUndefined()
  })

  it('はがす（書いた人・管理者）。5秒は元に戻せて、そのあとサーバーから消す。2週間より前はたたむ', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      await seed([
        { id: 'n', kind: 'tell', body: '換気扇のフィルター', by: '鈴木', byId: 'st-k', reads: [], createdAt: ago(5) },
        { id: 'o', kind: 'tell', body: '製氷機の音', by: '鈴木', byId: 'st-k', reads: [], createdAt: ago(24 * 20) },
      ])
      const { default: BoardPage } = await import('./BoardPage.vue')
      await mount(BoardPage)
      expect(note('製氷機')).toBeUndefined()
      await click(btn('2週間より前 1枚', board()))
      expect(board().querySelector('.bd-old').textContent).toContain('製氷機の音')
      await click(note('換気扇'))
      await click(btn('はがす', sheet()))
      expect(note('換気扇')).toBeUndefined()
      await click(btn('元に戻す', board()))
      expect(note('換気扇')).toBeTruthy()
      await click(note('換気扇'))
      await click(btn('はがす', sheet()))
      const { actHandoffInD1 } = await import('../composables/useStore.js')
      expect(actHandoffInD1).not.toHaveBeenCalledWith('n', 'delete')
      vi.advanceTimersByTime(5000); await tick()
      expect(actHandoffInD1).toHaveBeenCalledWith('n', 'delete')
    } finally { vi.useRealTimers() }
  })
})
