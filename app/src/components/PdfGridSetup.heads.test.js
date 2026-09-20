/**
 * 紙の見出しにある言葉を、全行に付く列に変える画面。
 *
 * 「○○店　4月　冷凍」のように、分類が見出しに1ヵ所しか書かれていない帳票がある。
 * 表に均すだけではその情報が落ちるので、タップして列に変えられるようにする。
 * 段階を増やさず表の直しと同じ画面に置いたのは、**足した列がその場で表に出る**ほうが
 * 分かるから（別の段階にすると、付いたかどうかを確かめられない）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6, h: 10 })

const PAGE = {
  rotate: 0,
  tokens: [
    t('○○店', 30, 790), t('4月', 120, 790), t('冷凍', 200, 790),
    t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
    t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
    t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
  ],
}

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      destroy: () => {},
      getPage: async () => ({
        rotate: 0,
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({
          items: PAGE.tokens.map(k => ({ str: k.text, width: k.w, height: 10, transform: [1, 0, 0, 1, k.x, k.y] })),
        }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, ready = []

const button = (txt) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(txt))
const chip   = (txt) => [...host.querySelectorAll('.gs-head')].find(b => b.textContent.trim() === txt)
const bodyRows = () => [...host.querySelectorAll('.gs-table tbody tr')]
  .map(tr => [...tr.children].slice(1).map(td => td.textContent.trim()))

async function mount() {
  const { default: PdfGridSetup } = await import('./PdfGridSetup.vue')
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfGridSetup, {
      file, pages: [PAGE], onReady: (p) => ready.push(p), onClose: () => {},
    }),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
  button('次へ').click()     // 表の段階へ
  await nextTick()
}

beforeEach(() => { ready = [] })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('PdfGridSetup — 見出しから列を足す', () => {
  it('見出しの語が候補として出る（品目の行は混ざらない）', async () => {
    await mount()
    expect([...host.querySelectorAll('.gs-head')].map(b => b.textContent.trim()))
      .toEqual(['○○店', '4月', '冷凍'])
  })

  it('タップするとその場で列が増え、全行に同じ値が入る', async () => {
    await mount()
    expect(bodyRows()[0].length).toBe(3)
    chip('冷凍').click()
    await nextTick()
    expect(host.textContent).toContain('全 3行 / 4列')
    expect(bodyRows().every(r => r[3] === '冷凍')).toBe(true)
  })

  it('もう一度タップすると外れる', async () => {
    await mount()
    chip('冷凍').click()
    await nextTick()
    chip('冷凍').click()
    await nextTick()
    expect(bodyRows()[0].length).toBe(3)
  })

  it('足した列は「合わせる／分ける」の対象にしない（紙の上に境界が無い）', async () => {
    await mount()
    chip('冷凍').click()
    await nextTick()
    const ths = [...host.querySelectorAll('.gs-table th')]
    expect(ths[4].className).toContain('add')
    ths[4].click()
    await nextTick()
    expect(host.querySelector('.gs-colbar')).toBe(null)
  })

  it('足した位置が作り方として渡る（値ではなく位置）', async () => {
    await mount()
    chip('4月').click()
    await nextTick()
    button('この表で進む').click()
    await nextTick()
    expect(ready[0].grid.heads).toEqual([{ x: 120, y: 790 }])
    // 表になったCSVには、その月の値が入っている
    expect(ready[0].csvText.split('\r\n')[1]).toBe('豚バラ,kg,1200,4月')
  })

  it('覚えているレシピは、その位置をそのまま選択済みにする', async () => {
    const { default: PdfGridSetup } = await import('./PdfGridSetup.vue')
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    file.arrayBuffer = async () => new ArrayBuffer(8)
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({
      render: () => h(PdfGridSetup, {
        file, pages: [PAGE],
        initial: { layout: { cols: 1, rows: 1 }, rowFactor: 0.5, edges: [], heads: [{ x: 200, y: 790 }] },
        onReady: (p) => ready.push(p), onClose: () => {},
      }),
    })
    app.mount(host)
    for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
    expect(chip('冷凍').className).toContain('on')
    expect(bodyRows().every(r => r[3] === '冷凍')).toBe(true)
  })
})
