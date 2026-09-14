// データ管理の「分類の追加」。分類は名前でしか見分けられないため、
// 分類①と分類②に同じ名前は付けさせない。弾いたことはその場で読めること。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: '', WS_BASE: '',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null
let host = null
let cfg = null

async function mountPage() {
  const { default: Page } = await import('./MasterManagePage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Page)
  app.mount(host)
  await nextTick()
  return host
}

const axisRows = () => [...host.querySelectorAll('.mm-axis-row')]
const err      = () => host.querySelector('.mm-axis-err')?.textContent.trim() ?? ''

// 分類②の行の入力欄へ打って「確定」を押す
async function typeAndConfirm(row, text) {
  const input = row.querySelector('.mm-axis-input')
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  row.querySelector('.mm-axis-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.config.axisNames = ['', '']
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('MasterManagePage — 分類の追加（同名の禁止）', () => {
  it('分類①と同じ名前は分類②に付けられず、理由がその場に出る', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()

    // ＋ 分類を追加 → 分類②の行を出す
    host.querySelector('.mm-axis-add').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    await typeAndConfirm(axisRows()[1], '保管場所')

    expect(cfg.config.axisNames).toEqual(['保管場所', ''])
    expect(err()).toContain('分類①')
  })

  it('別の名前なら確定でき、理由の表示も消える', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    host.querySelector('.mm-axis-add').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    await typeAndConfirm(axisRows()[1], '保管場所')
    expect(err()).not.toBe('')

    await typeAndConfirm(axisRows()[1], '仕入先')
    expect(cfg.config.axisNames).toEqual(['保管場所', '仕入先'])
    expect(err()).toBe('')
  })

  it('名前の変更でも、もう一方と同じ名前にはできない', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.setAxisName(1, '仕入先')
    await mountPage()

    // 分類②の ✎ から名前を変える
    axisRows()[1].querySelector('.mm-axis-edit').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    await typeAndConfirm(axisRows()[1], '保管場所')

    expect(cfg.config.axisNames).toEqual(['保管場所', '仕入先'])
    expect(err()).toContain('分類①')
  })
})
