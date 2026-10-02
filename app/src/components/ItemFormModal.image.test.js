// 品目の画像（R2）。選んだ時点で保存し、品目へ付けるのは追加・保存のとき。付けずに閉じたら消す。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const svc = vi.hoisted(() => ({
  compressItemImage: vi.fn(async () => ({ thumb: new Blob(['t']), full: new Blob(['f']) })),
  uploadItemImage: vi.fn(async () => 'ABCD/' + 'a'.repeat(32)),
  deleteItemImage: vi.fn(async () => {}),
  itemImageUrl: vi.fn(ref => ref ? `https://w/img/${ref}/t` : null),
  canUploadItemImage: vi.fn(() => true),
}))
vi.mock('../services/itemImages.js', () => svc)

const NEW = 'ABCD/' + 'a'.repeat(32)
const OLD = 'ABCD/' + 'b'.repeat(32)

let app = null, host = null, cfg, events
async function mount(props = {}) {
  const { default: Modal } = await import('./ItemFormModal.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  events = []
  const on = n => (...a) => events.push([n, ...a])
  app = createApp({ render: () => h(Modal, { ...props, onAdded: on('added'), onSaved: on('saved'), onClose: on('close') }) })
  app.mount(host)
  await tick()
}
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)), await nextTick() }
async function pick() {
  const input = host.querySelector('.if-file')
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true })
  input.dispatchEvent(new Event('change'))
  await tick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  Object.values(svc).forEach(f => f.mockClear?.())
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 100, '野菜', '個')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('品目フォームの写真', () => {
  it('追加：選んだ写真が品目に付く', async () => {
    await mount({ context: 'home' })
    await pick()
    expect(svc.uploadItemImage).toHaveBeenCalledTimes(1)
    const input = host.querySelector('#if-name')
    input.value = 'レタス'; input.dispatchEvent(new Event('input'))
    await tick()
    host.querySelector('.if-btn.pri').click()
    await tick()
    expect(cfg.config.images['レタス']).toBe(NEW)
    expect(svc.deleteItemImage).not.toHaveBeenCalled()
  })

  it('付けずに閉じたら、保存した写真を消す', async () => {
    await mount({ context: 'home' })
    await pick()
    host.querySelector('.if-btn.sec').click()
    await tick()
    expect(svc.deleteItemImage).toHaveBeenCalledWith(NEW)
    expect(events.some(e => e[0] === 'close')).toBe(true)
  })

  it('編集：写真を変えると前の写真を消す・外すと品目から外れる', async () => {
    cfg.setItemImage('トマト', OLD)
    await mount({ mode: 'edit', item: 'トマト' })
    await pick()
    host.querySelector('.if-btn.pri').click()
    await tick()
    expect(cfg.config.images['トマト']).toBe(NEW)
    expect(svc.deleteItemImage).toHaveBeenCalledWith(OLD)
  })

  it('ゲストの申請では写真の欄を出さない', async () => {
    await mount({ context: 'request', initialName: 'レタス' })
    host.querySelector('.if-more')?.click()
    await tick()
    expect(host.querySelector('.if-photo')).toBeNull()
  })

  it('名前を変えても写真は付いたまま・品目を消すと外れる', () => {
    cfg.setItemImage('トマト', OLD)
    cfg.updateConfigItem('トマト', 'ミニトマト', 100, '野菜')
    expect(cfg.config.images['ミニトマト']).toBe(OLD)
    expect(cfg.config.images['トマト']).toBeUndefined()
    expect(cfg.serializeConfigData().images).toEqual({ ミニトマト: OLD })
    cfg.removeConfigItem('ミニトマト')
    expect(cfg.config.images).toEqual({})
  })
})
