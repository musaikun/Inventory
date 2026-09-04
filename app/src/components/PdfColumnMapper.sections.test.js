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
/** 最初の問い「この紙、表は何枚ありますか？」に答える */
async function answerSections(n) {
  const btn = [...host.querySelectorAll('.secbtn')][n - 1]
  if (!btn) throw new Error('段数の選択肢が出ていない')
  btn.click()
  await nextTick()
}
function fieldButton(label) {
  return [...host.querySelectorAll('.field-bar button')].find(b => b.textContent.trim().startsWith(label))
}
describe('2段組みPDFを手動で指定できる', () => {
  it('列を触らせる前に、まず段の数を訊く', async () => {
    await mount()
    // 読んだ後では「右半分が無い」ことに気づけないので、読む前に紙を見せて確かめる
    expect(host.textContent).toContain('この紙、表は何枚ありますか？')
    expect(hits()).toHaveLength(0)
    // 自動判定は「印」であって選択値ではない
    const det = [...host.querySelectorAll('.secbtn.det')]
    expect(det).toHaveLength(1)
    expect(det[0].textContent).toContain('2')

    await answerSections(2)
    expect(host.textContent).not.toContain('この紙、表は何枚ありますか？')
    expect(hits().length).toBeGreaterThan(3)
  })

  it('答えた枚数ぶんの「品目名」を、1つずつ案内する', async () => {
    await mount()
    await answerSections(2)
    expect(host.querySelector('.mapper-guide').textContent).toContain('1枚目')

    const boxes = hits()
    boxes[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelector('.mapper-guide').textContent).toContain('2枚目')

    boxes[2].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelector('.mapper-guide').textContent).toContain('任意')
  })

  it('段の数は選び直せる（選び直すと列の指定も白紙に戻す）', async () => {
    await mount()
    await answerSections(2)
    hits()[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelectorAll('.assigned-chip')).toHaveLength(1)

    ;[...host.querySelectorAll('button')].find(b => b.textContent.includes('変える')).click()
    await nextTick()
    expect(host.textContent).toContain('この紙、表は何枚ありますか？')
    await answerSections(1)
    expect(host.querySelectorAll('.assigned-chip')).toHaveLength(0)
  })

  it('同じ項目を2か所に割り当てられ、チップも2つ出る', async () => {
    await mount()
    await answerSections(2)
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
    await answerSections(2)
    const boxes = hits()
    boxes[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelectorAll('.assigned-chip')).toHaveLength(1)

    boxes[0].click(); await nextTick()
    fieldButton('品目名').click(); await nextTick()
    expect(host.querySelectorAll('.assigned-chip')).toHaveLength(0)
  })
})
