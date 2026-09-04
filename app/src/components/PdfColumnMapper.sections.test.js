/**
 * 2段組みPDFの手動列指定。
 *
 * ここで確かめるのは「パーサが段を読めること」ではなく（それは pdfTableParser.test.js）、
 * **画面が段を表現できること**。以前は assign が field → { x, y } の1対1だったので、
 * 「品目名」を2か所タップする手段が構造上どこにも無かった。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

// 2段組み1ページぶんのトークン（左段 x=30.. / 右段 x=300..）
const TOKENS = (() => {
  const it = []
  const push = (t, x, y) => it.push({ str: t, transform: [1, 0, 0, 1, x, y] })
  push('品名', 30, 750); push('単価', 155, 750)
  push('品名', 300, 750); push('単価', 425, 750)
  push('豚バラ', 30, 720); push('1200', 155, 720)
  push('キャベツ', 300, 720); push('280', 425, 720)
  return it
})()

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: TOKENS }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, applied = []

async function mount() {
  const { default: Mapper } = await import('./PdfColumnMapper.vue')
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Mapper, { file, onClose: () => {}, onApply: (items) => applied.push(items) }),
  })
  app.mount(host)
  for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
}

beforeEach(() => { applied = [] })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

function hits() { return [...host.querySelectorAll('.hit')] }
function fieldButton(label) {
  return [...host.querySelectorAll('.field-bar button')].find(b => b.textContent.trim().startsWith(label))
}
describe('2段組みPDFを手動で指定できる', () => {
  it('同じ項目を2か所に割り当てられ、チップも2つ出る', async () => {
    await mount()
    const boxes = hits()
    expect(boxes.length, 'セルの当たり判定が出ている').toBeGreaterThan(3)

    // 左段の「品名」と右段の「品名」を、どちらも品目名として指定する
    boxes[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    boxes[2].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()

    const chips = [...host.querySelectorAll('.assigned-chip')].map(c => c.textContent.replace('×', '').trim())
    expect(chips.filter(c => c === '品目名')).toHaveLength(2)
  })

  it('同じ列をもう一度選ぶと外れる（付け外しが対称）', async () => {
    await mount()
    const boxes = hits()
    boxes[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelectorAll('.assigned-chip')).toHaveLength(1)

    boxes[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelectorAll('.assigned-chip')).toHaveLength(0)
  })
})
