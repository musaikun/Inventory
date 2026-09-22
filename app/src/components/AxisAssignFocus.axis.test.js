/**
 * グループ（まとめ方）そのものの設定を、この画面へ移したことの回帰（User指示 2026-09-21）。
 *
 * 以前はデータ管理の画面にグループの行があり、ここは未設定だと
 * 「管理画面で分類を追加してください」と突き放すだけだった。
 * **設定する場所と使う場所が離れている**と、作りに戻って、また開き直して、の往復になる。
 * 作るのも使うのもここで完結させる。
 *
 * グループは名前でしか見分けられないので、2つに同じ名前は付けさせない。
 * 弾いたことはその場で読めること。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg = null
const originalMatchMedia = globalThis.matchMedia

async function mount(initialAxis = 0) {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Focus, { initialAxis }) })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}
const btn    = (t) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(t))
const dialog = () => host.querySelector('.af-axis-dialog')
const input  = () => host.querySelector('.af-axis-dialog .af-dialog-input')
const tabs   = () => [...host.querySelectorAll('.af-tab')].map(b => b.textContent.trim())
// ダイアログの決定ボタン。画面には「＋ グループを作る」も出ているので、文言で拾わない
const ok     = () => dialog().querySelector('.af-dialog-ok')

async function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await nextTick()
}
async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  for (let i = 0; i < 3; i++) await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const mod = await import('../composables/useConfig.js')
  cfg = mod.useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '', '個')
})
afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  globalThis.matchMedia = originalMatchMedia
  delete globalThis.confirm
})

describe('グループが1つも無いとき', () => {
  it('突き放さずに、その場で作れる', async () => {
    await mount()
    expect(host.textContent).toContain('まず、まとめ方を1つ決めます')
    expect(host.textContent).not.toContain('品目マスタ管理')

    await click(btn('グループを作る'))
    expect(dialog()).not.toBeNull()
    await type(input(), '保管場所')
    await click(ok())

    expect(cfg.config.axisNames[0]).toBe('保管場所')
    expect(dialog()).toBeNull()
    expect(tabs()).toEqual(['保管場所'])
  })

  it('名前が空のままでは作れない', async () => {
    await mount()
    await click(btn('グループを作る'))
    expect(ok().disabled).toBe(true)
  })
})

describe('グループの名前', () => {
  it('タブの✎から変えられる', async () => {
    cfg.setAxisName(0, '保管場所')
    await mount()
    await click(host.querySelector('.af-tab-edit'))
    await type(input(), '置き場')
    await click(ok())
    expect(cfg.config.axisNames[0]).toBe('置き場')
    expect(tabs()).toEqual(['置き場'])
  })

  it('もう一方と同じ名前は付けられず、理由がその場に出る', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.setAxisName(1, '仕入先')
    await mount()
    await click(host.querySelector('.af-tab-edit'))
    await type(input(), '仕入先')
    await click(ok())

    expect(host.querySelector('.af-axis-dialog .af-dialog-err').textContent).toContain('同じ名前')
    expect(cfg.config.axisNames[0]).toBe('保管場所')   // 変わっていない
    expect(dialog()).not.toBeNull()                    // 閉じない

    await type(input(), '置き場')
    expect(host.querySelector('.af-axis-dialog .af-dialog-err')).toBeNull()   // 直したら理由は消える
    await click(ok())
    expect(cfg.config.axisNames[0]).toBe('置き場')
  })
})

describe('グループの追加と削除', () => {
  it('空きがあるときだけ＋が出る（グループは2つまで）', async () => {
    cfg.setAxisName(0, '保管場所')
    await mount()
    expect(host.querySelector('.af-tab-add')).not.toBeNull()

    await click(host.querySelector('.af-tab-add'))
    await type(input(), '仕入先')
    await click(ok())
    expect(cfg.config.axisNames).toEqual(['保管場所', '仕入先'])
    expect(host.querySelector('.af-tab-add')).toBeNull()
  })

  it('作った直後は、そのグループに切り替わっている', async () => {
    cfg.setAxisName(0, '保管場所')
    await mount()
    await click(host.querySelector('.af-tab-add'))
    await type(input(), '仕入先')
    await click(ok())
    expect(host.querySelector('.af-tab.on').textContent.trim()).toBe('仕入先')
  })

  it('削除は、何が外れるかを言ってから', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    await mount()
    let asked = ''
    globalThis.confirm = (m) => { asked = m; return true }

    await click(host.querySelector('.af-tab-edit'))
    await click(btn('このグループを削除'))

    expect(asked).toContain('振り分けもすべて外れます')
    expect(cfg.config.axisNames[0]).toBe('')
    expect(cfg.config.tagsA).toEqual({})
  })

  it('やめれば消えない', async () => {
    cfg.setAxisName(0, '保管場所')
    await mount()
    globalThis.confirm = () => false
    await click(host.querySelector('.af-tab-edit'))
    await click(btn('このグループを削除'))
    expect(cfg.config.axisNames[0]).toBe('保管場所')
  })
})
