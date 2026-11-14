// チェック表（ひな形）を作る・直す: 外を触っても消さずに確かめる・項目を書き直せる（User 2026-11-08）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// 確認・お知らせはアプリの中のシート。答えは従来どおり confirm / alert の stub で決める（test-stubs/askConfirmBridge.js）
vi.mock('../composables/askConfirm.js', async (orig) => (await import('../test-stubs/askConfirmBridge.js')).bridge(await orig()))
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../composables/useStore.js', async (orig) => ({ ...(await orig()), loadTemplatesFromD1: vi.fn(async () => null), saveTemplateToD1: vi.fn(async () => ({ ok: true })) }))

let app = null, host = null
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input')); await tick() }
const sh = () => document.body.querySelector('.ct-sh')
const btn = (label, root = document.body) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function mount() {
  const { default: Page } = await import('./ChecklistTemplatesPage.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(Page) }); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木') })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = ''; vi.restoreAllMocks() })

async function startNew() {
  await click(btn('チェック表を作る'))
  await type(sh().querySelector('input[aria-label="チェック表の名前"]'), '閉店チェック')
  for (const t of ['ガスの元栓', 'レジ締め']) {
    await type(sh().querySelector('input[aria-label="項目"]'), t)
    sh().dispatchEvent(new Event('submit', { cancelable: true })); await tick()
  }
}

describe('チェック表を作る・直す', () => {
  it('作りかけで外を触ると確かめる。やめれば残り、はいなら閉じる。何も入れていなければそのまま閉じる', async () => {
    await mount()
    await click(btn('チェック表を作る'))
    await click(document.body.querySelector('.ct-bg'))
    expect(sh(), '空なら確かめずに閉じる').toBeNull()
    await startNew()
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await click(document.body.querySelector('.ct-bg'))
    expect(ask).toHaveBeenCalledWith('作りかけのチェック表を捨てて閉じますか？')
    expect(sh(), 'やめたら残る').not.toBeNull()
    expect([...sh().querySelectorAll('.ct-it')].map(e => e.value)).toEqual(['ガスの元栓', 'レジ締め'])
    ask.mockReturnValue(true)
    await click(sh().querySelector('[aria-label="閉じる"]'))
    expect(sh()).toBeNull()
  })

  it('足した項目は押して書き直せる。空にすると消える。保存すると直した文で残る', async () => {
    await mount()
    await startNew()
    const its = () => [...sh().querySelectorAll('.ct-it')]
    await type(its()[0], 'ガスの元栓を閉める')
    its()[0].dispatchEvent(new Event('blur')); await tick()
    await type(its()[1], '  ')
    its()[1].dispatchEvent(new Event('blur')); await tick()
    expect(its().map(e => e.value)).toEqual(['ガスの元栓を閉める'])
    await click(btn('保存', sh()))
    const { checklistTemplates } = await import('../composables/useTemplates.js')
    expect(checklistTemplates.value.map(t => [t.name, t.data.items.map(x => x.text)])).toEqual([['閉店チェック', ['ガスの元栓を閉める']]])
  })
  it('項目は ⋮⋮ で並べ替えられる（上下キーでも）。保存すると並べた順で残る', async () => {
    await mount()
    await startNew()
    await type(sh().querySelector('input[aria-label="項目"]'), '電気を消す')
    sh().dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    const order = () => [...sh().querySelectorAll('.ct-it')].map(e => e.value)
    expect(order()).toEqual(['ガスの元栓', 'レジ締め', '電気を消す'])
    const h = () => [...sh().querySelectorAll('.ct-handle')]
    h()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await tick()
    h()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await tick()
    expect(order()).toEqual(['レジ締め', '電気を消す', 'ガスの元栓'])
    await click(btn('保存', sh()))
    const { checklistTemplates } = await import('../composables/useTemplates.js')
    expect(checklistTemplates.value[0].data.items.map(x => x.text)).toEqual(['レジ締め', '電気を消す', 'ガスの元栓'])
  })
})
