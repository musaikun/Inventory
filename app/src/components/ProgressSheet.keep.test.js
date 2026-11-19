// 進行中の手順を、チェック表として残す（User 2026-11-19）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({
  ...(await orig()), loadTemplatesFromD1: vi.fn(async () => null), saveTemplateToD1: vi.fn(async () => ({ ok: true })),
  loadTaskNotesFromD1: vi.fn(async () => ({ notes: [] })),
}))

let app = null
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
const task = steps => ({ id: 't1', date: '2026-11-19', text: '製氷機の修理', progress: 'doing', deadline: null, doneAt: null, createdAt: new Date().toISOString(), createdBy: 'オーナー', assign: 'anyone', steps })
async function mount(t) {
  const { default: Sheet } = await import('./ProgressSheet.vue')
  const host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(Sheet, { task: t }) }); app.mount(host); await tick()
}
const keepBtn = () => document.body.querySelector('.ps-keep')
beforeEach(() => { localStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木') })
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

describe('ProgressSheet — 手順をチェック表に入れる', () => {
  it('手で入れた手順があれば出す。押すと名前を訊き、入れたら知らせる', async () => {
    await mount(task([{ id: 's1', text: '業者に電話', done: true }, { id: 's2', text: '立ち会い', done: false }]))
    keepBtn().click(); await tick()
    const A = await import('../composables/askConfirm.js')
    expect(A.confirmState.value.title).toBe('チェック表の名前')
    expect(A.confirmState.value.value).toBe('製氷機の修理')
    A.answerConfirm(true); await tick()
    expect(document.body.querySelector('.ps-kept').textContent).toContain('製氷機の修理')
    const T = await import('../composables/useTemplates.js')
    expect(T.checklistTemplates.value.map(t => t.name)).toEqual(['製氷機の修理'])
    expect(keepBtn()).toBeNull()                                  // 入れたあとは同じものがあるので出さない
  })

  it('手順が無いときと、チェック表から付けた手順のときは出さない', async () => {
    await mount(task([]))
    expect(keepBtn()).toBeNull()
    app.unmount(); document.body.innerHTML = ''
    const T = await import('../composables/useTemplates.js')
    await T.saveChecklistTemplate(null, '修理の流れ', [{ text: '業者に電話' }, { text: '立ち会い' }])
    await mount(task([{ id: 's1', text: '業者に電話', done: false }, { id: 's2', text: '立ち会い', done: false }]))
    expect(keepBtn()).toBeNull()
  })
})
