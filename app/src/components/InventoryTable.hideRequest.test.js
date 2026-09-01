/**
 * ゲストからの非表示申請（User 要件）。
 *
 * ホストは今までどおり自分で隠せる（確認ダイアログ or 全スワイプ）。
 * ゲストは**申請しか出せない**。ここで守りたいのは、ゲストの操作が
 * `hide-item`（その場で隠す）ではなく `request-hide` として出ること。
 * 取り違えると、ゲストの端末だけ先に隠れて、次の config 同期で戻ってくる。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props = {}) {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Table, { inventory: {}, filledCount: 0, ...props }) })
  app.mount(host)
  await nextTick()
  host.querySelector('thead tr').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  return host
}

const row    = (name) => host.querySelector(`tr.item-row[data-item="${name}"]`)
const action = () => host.querySelector('.row-action')
const dialog = () => host.querySelector('.hide-dialog')

function touch(el, type, x, y = 0) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  ev.changedTouches = [{ clientX: x, clientY: y }]
  el.dispatchEvent(ev)
}
async function swipe(name, dx) {
  const el = row(name)
  touch(el, 'touchstart', 300, 100)
  touch(el, 'touchmove', 300 + dx, 100)
  await nextTick()
  return el
}
async function release(el) {
  touch(el, 'touchend', 0, 0)
  await nextTick()
}
const click = async (el) => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await nextTick() }

// ゲスト = リスト操作は不可、申請だけできる
const asGuest = { canManageList: false, canRequestHide: true }

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('InventoryTable — ゲストの非表示申請', () => {
  it('ゲストが引き切ると request-hide を出す（その場では隠さない）', async () => {
    const onHideItem = vi.fn(), onRequestHide = vi.fn()
    await mount({ ...asGuest, onHideItem, onRequestHide })

    const el = await swipe('トマト', -220)
    expect(action().textContent.trim()).toBe('離すと申請')   // 文言で「申請」と分かる
    await release(el)

    expect(onRequestHide).toHaveBeenCalledWith('トマト')
    expect(onHideItem).not.toHaveBeenCalled()
  })

  it('ゲストの浅いスワイプは確認ダイアログを出し、申請だと書いてある', async () => {
    const onHideItem = vi.fn(), onRequestHide = vi.fn()
    await mount({ ...asGuest, onHideItem, onRequestHide })

    const el = await swipe('トマト', -70)
    expect(action().textContent.trim()).toBe('申請')
    await release(el)
    await click(action())

    expect(dialog().textContent).toContain('ホストに申請')
    expect(onRequestHide).not.toHaveBeenCalled()          // ダイアログを出しただけ

    await click(host.querySelector('.hide-dialog-ok'))
    expect(onRequestHide).toHaveBeenCalledWith('トマト')
    expect(onHideItem).not.toHaveBeenCalled()
  })

  it('ホストは従来どおり hide-item を出す', async () => {
    const onHideItem = vi.fn(), onRequestHide = vi.fn()
    await mount({ onHideItem, onRequestHide })

    const el = await swipe('トマト', -220)
    expect(action().textContent.trim()).toBe('離すと非表示')
    await release(el)

    expect(onHideItem).toHaveBeenCalledWith('トマト')
    expect(onRequestHide).not.toHaveBeenCalled()
  })

  // 申請を許していないゲスト（既定）は、これまでどおりスワイプ自体が効かない。
  it('申請が許可されていなければスワイプは効かない', async () => {
    const onHideItem = vi.fn(), onRequestHide = vi.fn()
    await mount({ canManageList: false, onHideItem, onRequestHide })

    const el = await swipe('トマト', -220)
    expect(action()).toBeNull()
    await release(el)

    expect(onHideItem).not.toHaveBeenCalled()
    expect(onRequestHide).not.toHaveBeenCalled()
  })

  // 完了済みの閲覧（読み取り専用）では、申請も出させない。
  it('読み取り専用では申請もできない', async () => {
    const onRequestHide = vi.fn()
    await mount({ readOnly: true, canRequestHide: true, onRequestHide })

    const el = await swipe('トマト', -220)
    expect(action()).toBeNull()
    await release(el)

    expect(onRequestHide).not.toHaveBeenCalled()
  })
})
