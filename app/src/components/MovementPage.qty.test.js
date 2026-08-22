// 入出庫の記録行を「タップして NumPad」に寄せたことの回帰（棚卸・発注と同じ操作感）。
// 行内の −/＋/＋箱 は連打用に残す。ここが行タップと二重に発火すると、
// 数えたつもりのない数量が入る。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../composables/useStore.js', () => ({
  saveMovementToD1:      vi.fn(),
  importPastSessionToD1: vi.fn(),
  cancelPastImportOnD1:  vi.fn(),
  shopCode: { value: 'ABCDEF' },
}))
vi.mock('../composables/usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  excelToCsv:            vi.fn(async () => ''),
}))

let app = null
let host = null
let cfg

async function mountPage() {
  const { default: MovementPage } = await import('./MovementPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(MovementPage, { onBack: () => {}, onSaved: () => {} }) })
  app.mount(host)
  await nextTick()
  return host
}

/** 分類グループは既定で畳まれているので開く */
async function expandGroups() {
  const b = button('すべて開く')
  if (b) { b.click(); await nextTick() }
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
}
async function click(el) { el.click(); await nextTick() }
const rows = () => [...host.querySelectorAll('.mv-item')]
const qtyChip = (row) => row.querySelector('.mv-step-val')

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', null, '', '個')
  cfg.addItem('レタス', null, '', '玉')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('MovementPage — 数量入力', () => {
  it('在庫タブでは数量入力シートを開かない（読み取り専用）', async () => {
    await mountPage()
    await expandGroups()
    await click(rows()[0])
    expect(host.querySelector('.mq-sheet')).toBeNull()
  })

  it('入庫タブで行をタップすると NumPad シートが開き、確定で行に反映される', async () => {
    await mountPage()
    await click(button('📥 入庫'))
    await expandGroups()

    await click(rows()[0])
    const sheet = host.querySelector('.mq-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('トマト')

    await click(button('5'))
    await click(button('この数量にする'))

    expect(host.querySelector('.mq-sheet')).toBeNull()
    expect(qtyChip(rows()[0]).textContent.trim()).toBe('5')
    expect(host.querySelector('.mv-savebar').textContent).toContain('入庫 1品目')
  })

  it('行内の ＋ はシートを開かずにその場で加算する', async () => {
    await mountPage()
    await click(button('📥 入庫'))
    await expandGroups()

    const row = rows()[0]
    await click([...row.querySelectorAll('.mv-step')].at(-1))   // ＋
    expect(host.querySelector('.mq-sheet')).toBeNull()          // 行タップは発火しない
    expect(qtyChip(rows()[0]).textContent.trim()).toBe('1')
  })

  it('数量チップからも同じシートを開ける', async () => {
    await mountPage()
    await click(button('📤 出庫'))
    await expandGroups()
    await click(qtyChip(rows()[1]))
    const sheet = host.querySelector('.mq-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('レタス')
    expect(sheet.textContent).toContain('出庫')
  })

  it('直接入力欄（OSキーボード）は残っていない', async () => {
    await mountPage()
    await click(button('📥 入庫'))
    await expandGroups()
    const row = rows()[0]
    expect(row.querySelector('input')).toBeNull()
  })
})
