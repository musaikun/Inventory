// データ管理の作り直し（2026-09-15）。
//   - 取り込む / 書き出す の入口を1つずつにし、押してから種類を選ぶ
//   - 並び順は「グループ」で数える。ジャンルも取込元由来のグループとして同じ列に並ぶ
//   - 2026-09-23: 品目一覧は常設をやめ「設定済み品目一覧」のボタンから別ページで開く
//   - 2026-09-24: 設定済み品目一覧は確認用にする（発注点・目標・出す/出さないの欄を外す）
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

const rowTitles = sel => [...host.querySelectorAll(sel)].map(e => e.textContent.trim())
const topRows   = () => rowTitles('.mp-scroll > .mm-card .mm-row-title')
const sheet     = () => host.querySelector('.mm-pick')
const sheetRows = () => rowTitles('.mm-pick .mm-row-title')
const groupRows = () => [...host.querySelectorAll('.mm-axis-row')]
const invRow    = name => [...host.querySelectorAll('.item-row')]
  .find(r => r.querySelector('.name-main')?.textContent.trim().startsWith(name))

// 設定済み品目一覧のページを開く
async function openList() {
  await click(host.querySelector('.mm-listopen'))
}

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
async function setInput(el, value) {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  cfg.config.axisNames = ['', '']
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('取り込む / 書き出す（ホームのカードから開く・管理から移した 2026-10-14）', () => {
  // DataPort をホームのカードと同じく open(kind) で開く
  let port = null
  async function mountPort() {
    const { default: DataPort } = await import('./DataPort.vue')
    const { h, ref } = await import('vue')
    const r = ref(null)
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(DataPort, { ref: r }) })
    app.mount(host)
    await nextTick()
    port = r.value
  }

  it('設定（以前の管理）には取り込む・書き出すの入口を置かない', async () => {
    await mountPage()
    expect(topRows()).toEqual([])
  })

  it('「取り込む」で、種類（品目リスト・過去の納品・過去の棚卸）を選べる', async () => {
    await mountPort()
    expect(sheet()).toBeNull()
    port.open('import'); await nextTick()
    expect(sheetRows()).toEqual(['品目リスト', '過去の納品', '過去の棚卸'])
  })

  it('「書き出す」で、品目リストと棚卸結果を選べる', async () => {
    await mountPort()
    port.open('export'); await nextTick()
    expect(sheetRows()).toEqual(['品目リスト', '棚卸結果'])
  })

  it('戻る操作は、画面を閉じる前にシートを閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mountPort()
    port.open('import'); await nextTick()
    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(sheet()).toBeNull()
  })
})
