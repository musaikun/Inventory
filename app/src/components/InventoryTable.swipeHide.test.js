// 手動非表示の左スワイプを2段階にしたことの回帰。
//   浅いスワイプ … 「非表示」ボタンが出て止まる → 押すと確認ダイアログ（従来どおり）
//   全スワイプ   … 引き切って離す               → 確認を挟まずその場で非表示
// 守りたいのは「引き切ったときだけ確認を飛ばす」こと。浅いスワイプまで無確認になると、
// 縦スクロールの巻き添えで品目が消える。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props = {}) {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Table, { inventory: {}, filledCount: 0, ...props }),
  })
  app.mount(host)
  await nextTick()
  // グループは既定で閉じている。ヘッダーの ▶ で全部開いて品目行を出す
  host.querySelector('thead tr').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  return host
}

const row      = (name) => host.querySelector(`tr.item-row[data-item="${name}"]`)
const bg       = () => action()?.style.backgroundColor
const action   = () => host.querySelector('.row-action')
const dialog   = () => host.querySelector('.hide-dialog')

// jsdom は TouchEvent を持たないので、ハンドラが見る changedTouches だけを載せる
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

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('InventoryTable — 左スワイプで非表示', () => {
  it('引き切って離すと確認ダイアログを出さずに非表示にする', async () => {
    const onHideItem = vi.fn()
    await mount({ onHideItem })

    const el = await swipe('トマト', -220)
    // 引き切った状態は文言でも分かる
    expect(action().textContent.trim()).toBe('離すと非表示')

    await release(el)

    expect(onHideItem).toHaveBeenCalledTimes(1)
    expect(onHideItem).toHaveBeenCalledWith('トマト')
    expect(dialog()).toBeNull()          // 確認は挟まない
    expect(action()).toBeNull()          // スワイプ状態も解除される
  })

  // 「あとどれだけ引けば確定するか」を、離す前に色で読めるようにしている。
  it('引くほど灰から赤へ寄り、閾値で赤になる', async () => {
    await mount({ onHideItem: vi.fn() })

    const el = await swipe('トマト', -40)      // 出た瞬間（REVEAL_AT ちょうど）
    const near0 = bg()
    expect(near0).toBe('rgb(100, 116, 139)')   // まだ灰のまま

    touch(el, 'touchmove', 300 - 100, 100)     // 途中
    await nextTick()
    const mid = bg()
    expect(mid).not.toBe(near0)
    expect(mid).not.toBe('rgb(220, 38, 38)')

    touch(el, 'touchmove', 300 - 220, 100)     // 引き切り
    await nextTick()
    expect(bg()).toBe('rgb(220, 38, 38)')
    expect(action().classList.contains('full')).toBe(true)
  })

  it('浅いスワイプは従来どおり「非表示」ボタンで止まり、確認を挟む', async () => {
    const onHideItem = vi.fn()
    await mount({ onHideItem })

    const el = await swipe('トマト', -70)
    expect(action().textContent.trim()).toBe('非表示')   // まだ引き切っていない
    await release(el)

    expect(onHideItem).not.toHaveBeenCalled()            // 離しただけでは消えない
    expect(action()).not.toBeNull()                      // 開いたまま止まる

    action().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(dialog()).not.toBeNull()
    expect(onHideItem).not.toHaveBeenCalled()            // ダイアログを出しただけ

    ;[...host.querySelectorAll('.hide-dialog-ok')][0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(onHideItem).toHaveBeenCalledWith('トマト')
  })

  it('指を離す前に戻せば何も起きない', async () => {
    const onHideItem = vi.fn()
    await mount({ onHideItem })

    const el = await swipe('トマト', -220)
    touch(el, 'touchmove', 300 - 10, 100)   // 引き切ったところから戻す
    await nextTick()
    expect(action()).toBeNull()             // 表示の閾値も下回る
    await release(el)

    expect(onHideItem).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('縦スクロールでは非表示にしない', async () => {
    const onHideItem = vi.fn()
    await mount({ onHideItem })

    const el = row('トマト')
    touch(el, 'touchstart', 300, 100)
    touch(el, 'touchmove', 290, 400)        // 主に縦方向
    await nextTick()
    await release(el)

    expect(onHideItem).not.toHaveBeenCalled()
  })

  it('ゲスト（リスト操作不可）は引き切っても非表示にならない', async () => {
    const onHideItem = vi.fn()
    await mount({ onHideItem, canManageList: false })

    const el = await swipe('トマト', -220)
    expect(action()).toBeNull()
    await release(el)

    expect(onHideItem).not.toHaveBeenCalled()
  })
})
