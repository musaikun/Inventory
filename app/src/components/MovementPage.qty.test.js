// 入出庫の記録タブを棚卸・発注と同じ一覧（InventoryTable）にそろえたことの回帰。
// 守りたいのは見た目ではなく契約:
//   ・数量セルをタップ → NumPad シート、という導線が3画面で同じ
//   ・入出庫に無い概念（金額列・連続入力・非表示スワイプ）を持ち込まない
//   ・在庫タブは読み取り専用のまま（入力シートを開かない）
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

async function mountPage(props = {}) {
  const { default: MovementPage } = await import('./MovementPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(MovementPage, { onBack: () => {}, onSaved: () => {}, ...props }) })
  app.mount(host)
  await nextTick()
  return host
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
}
async function click(el) { el.click(); await nextTick() }
async function openTab(label) {
  await click(button(label))
  const expand = button('全て開く') || button('すべて開く')
  if (expand) await click(expand)
}
const table = () => host.querySelector('.inventory-section')
const itemRows = () => [...host.querySelectorAll('.item-row')]
const rowOf = (name) => itemRows().find(r => r.textContent.includes(name))
const qtyOf = (name) => rowOf(name).querySelector('.qty-display').textContent.trim()

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '', '個')
  cfg.addItem('レタス', 80, '', '玉')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('MovementPage — 棚卸・発注と同じ一覧', () => {
  it('在庫タブも同じ一覧を使い、数量セルは理論在庫を出す', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      s1: {
        sessionId: 's1', date: '2026-08-01', savedAt: '2026-08-01T01:00:00Z',
        items: [{ item: 'トマト', qty: 10, unit: '個', unitPrice: 120, subtotal: 1200 }],
      },
    }))
    await mountPage()
    await openTab('在庫')

    expect(table()).not.toBeNull()
    expect(qtyOf('トマト')).toContain('10')
    // 進捗は在庫の意味に差し替わる
    expect(host.textContent).toContain('要補充')
    expect(host.textContent).not.toContain('件入力済み')
  })

  // 状態の絞り込み（すべて / 在庫あり / 要補充）は持たない。在庫タブは常に全品目を出し、
  // 表の既定チップ（入力済み/未入力）も在庫の意味には合わないので出さない。
  it('在庫タブは状態の絞り込みチップを持たない', async () => {
    await mountPage()
    await openTab('在庫')

    const labels = [...host.querySelectorAll('.seg-btn')].map(b => b.textContent.trim())
    for (const gone of ['すべて', '在庫あり', '要補充', '入力済み', '未入力']) {
      expect(labels).not.toContain(gone)
    }
    // 発注基準の設定は残す
    expect([...host.querySelectorAll('button')].some(b => b.textContent.includes('発注基準を設定'))).toBe(true)
  })

  // 取込はデータ管理へ集約した。同じ取込に2つの入口があると、どちらが正か分からなくなる。
  it('取込の入口を持たない（データ管理へ集約）', async () => {
    await mountPage()
    for (const tab of ['在庫', '📥 入庫', '📤 出庫']) {
      await openTab(tab)
      // ファイル選択も「取り込む」ボタンも持たない（案内文は残ってよい）
      expect(host.querySelector('input[type="file"]')).toBeNull()
      const importBtns = [...host.querySelectorAll('button')].filter(b => b.textContent.includes('取り込'))
      expect(importBtns).toEqual([])
    }
  })

  it('算出できないときはデータ管理へ案内する（取込画面を持たない）', async () => {
    const opened = []
    await mountPage({ onOpenMaster: () => opened.push(true) })
    await openTab('在庫')
    const gate = button('データ管理へ')
    expect(gate).not.toBeUndefined()
    await click(gate)
    expect(opened).toHaveLength(1)
  })

  it('在庫タブから発注基準を設定でき、仮定を保存すると棚卸1回でも仮の発注点が出る', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      s1: {
        sessionId: 's1', date: '2026-08-01', savedAt: '2026-08-01T01:00:00Z',
        items: [{ item: 'トマト', qty: 40, unit: '個', unitPrice: 120, subtotal: 4800 }],
      },
    }))
    await mountPage()
    await openTab('在庫')
    await click(button('🎯 発注基準を設定'))
    const sheet = host.querySelector('.ob-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('仮の')

    await click(button('この仮定で出す'))
    // 既定: 届くまで1日・余裕1日・週1 → 5日分。40 ÷ 5 × 2 = 16
    expect(cfg.config.orderAssumptions).toMatchObject({ leadDays: 1, safetyDays: 1 })
    const row = [...host.querySelectorAll('.ob-row')].find(r => r.textContent.includes('トマト'))
    expect(row.textContent).toContain('仮')
    expect(row.querySelector('.ob-input').getAttribute('placeholder')).toBe('16')
    // 在庫の記録が無い品目は出さない
    const lettuce = [...host.querySelectorAll('.ob-row')].find(r => r.textContent.includes('レタス'))
    expect(lettuce.textContent).toContain('未設定')
    // 仮の値は保存しない
    expect(cfg.config.reorderPoints['トマト']).toBeUndefined()
  })

  it('在庫タブの行タップは数量入力ではなく詳細シートを開く', async () => {
    await mountPage()
    await openTab('在庫')
    await click(rowOf('トマト'))

    expect(host.querySelector('.mq-sheet')).toBeNull()      // 数量入力は開かない
    const sheet = host.querySelector('.sd-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('トマト')
    expect(sheet.textContent).toContain('発注点')
  })

  it('入庫タブは棚卸と同じ一覧を出す', async () => {
    await mountPage()
    await openTab('📥 入庫')
    expect(table()).not.toBeNull()
    expect(rowOf('トマト')).not.toBeUndefined()
    // 未入力は棚卸と同じ「—」表示
    expect(qtyOf('トマト')).toBe('—')
  })

  it('行タップで NumPad シートが開き、確定すると数量セルに入る', async () => {
    await mountPage()
    await openTab('📥 入庫')

    await click(rowOf('トマト'))
    const sheet = host.querySelector('.mq-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('トマト')

    await click(button('5'))
    await click(button('この数量にする'))

    expect(host.querySelector('.mq-sheet')).toBeNull()
    expect(qtyOf('トマト')).toContain('5')
    expect(host.querySelector('.mv-savebar').textContent).toContain('入庫 1品目')
  })

  it('金額列・連続入力・非表示スワイプを持ち込まない', async () => {
    await mountPage()
    await openTab('📤 出庫')
    // 単価が入っていても在庫金額の列は出さない（入出庫は在庫金額の画面ではない）
    expect(host.querySelector('.th-amount')).toBeNull()
    expect(host.querySelector('.tap-continuous-toggle')).toBeNull()
    // 一覧の管理操作（非表示スワイプ・軸の編集）は渡していない
    expect(host.querySelector('.row-action')).toBeNull()
    expect(host.querySelector('.seg-add')).toBeNull()
  })

  it('理論在庫と記録後の値を行のヒントに出す（出庫で在庫を割り込むのに気づける）', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      s1: {
        sessionId: 's1', date: '2026-08-01', savedAt: '2026-08-01T01:00:00Z',
        items: [{ item: 'トマト', qty: 10, unit: '個', unitPrice: 120, subtotal: 1200 }],
      },
    }))
    await mountPage()
    await openTab('📤 出庫')

    expect(rowOf('トマト').querySelector('.note-hint').textContent).toContain('理論: 10個')

    await click(rowOf('トマト'))
    await click(button('3'))
    await click(button('この数量にする'))
    // 出庫は減算で見せる
    expect(rowOf('トマト').querySelector('.note-hint').textContent).toContain('→ 7個')
  })
})
