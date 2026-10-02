// 品目を足す画面は1つに統一（User決定 2026-10-02）。場面（context）ごとの振る舞いを固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null, host = null, cfg, events
async function mount(props = {}) {
  const { default: Modal } = await import('./ItemFormModal.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  events = []
  const on = n => (...a) => events.push([n, ...a])
  app = createApp({ render: () => h(Modal, {
    ...props,
    onAdded: on('added'), onRequest: on('request'), onUnhide: on('unhide'), onUseExisting: on('use-existing'), onClose: on('close'),
  }) })
  app.mount(host)
  for (let i = 0; i < 3; i++) await nextTick()
}
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
const pri = () => host.querySelector('.if-btn.pri')

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 100, '野菜', '個')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('棚卸・発注中（session）', () => {
  it('名前は引き継ぎ、名前以外は「詳しく」に畳む。登録したら1品目だけで終わる', async () => {
    await mount({ context: 'session', initialName: 'レタス', initialUnit: '玉' })
    expect(host.querySelector('.if-title').textContent).toBe('新しい品目を登録')
    expect(host.querySelector('#if-name').value).toBe('レタス')
    expect(host.querySelector('#if-unit')).toBeNull()          // 畳まれている
    expect(pri().textContent).toContain('登録して数量へ')
    pri().click(); await tick()
    expect(events).toContainEqual(['added', 'レタス'])
    expect(cfg.config.order).toContain('レタス')
    expect(cfg.config.units['レタス']).toBe('玉')               // 声で言った単位を引き継ぐ
    expect(host.querySelector('#if-name').value).toBe('レタス') // 続けて入れる形にしない
  })

  it('「詳しく」で単位・入数・ジャンル・単価を出せる', async () => {
    await mount({ context: 'session', initialName: 'レタス' })
    host.querySelector('.if-more').click(); await tick()
    expect(host.querySelector('#if-unit')).not.toBeNull()
    expect(host.querySelector('#if-price')).not.toBeNull()
  })

  it('非表示の品目と同じ名前なら、新しく作らず「表示に戻して使う」', async () => {
    cfg.hideItem('トマト')
    await mount({ context: 'session', initialName: 'トマト' })
    expect(host.textContent).toContain('非表示にしている品目です')
    ;[...host.querySelectorAll('.if-inline')].find(b => b.textContent.includes('表示に戻して使う')).click(); await tick()
    expect(events).toContainEqual(['unhide', 'トマト'])
  })
})

describe('ゲスト（request）', () => {
  it('登録はせず、ホストへの申請として送る', async () => {
    await mount({ context: 'request', initialName: 'レタス' })
    expect(pri().textContent).toContain('ホストに申請する')
    pri().click(); await tick()
    expect(events.find(e => e[0] === 'request')[1]).toMatchObject({ name: 'レタス' })
    expect(cfg.config.order).not.toContain('レタス')
  })
})

describe('ホーム（home）', () => {
  it('今までどおり続けて入れられる（詳しくは最初から開いている）', async () => {
    await mount({ context: 'home' })
    expect(host.querySelector('#if-unit')).not.toBeNull()
    host.querySelector('#if-name').value = 'レタス'
    host.querySelector('#if-name').dispatchEvent(new Event('input')); await tick()
    pri().click(); await tick()
    expect(host.querySelector('#if-name').value).toBe('')
  })
})
