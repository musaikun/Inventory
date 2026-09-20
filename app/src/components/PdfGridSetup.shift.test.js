/**
 * ずれの直しと、ずれの見つけ方（画面側）。
 *
 * ずれは**目で探させない**。先頭の数十行だけを見せていたときは、後ろのページで
 * ずれていても最後まで気づけなかった（紙は何ページもあるのに、確かめられるのは
 * 1ページ目だけだった）。全行出したうえで印を付け、そこだけ見られるようにする。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6, h: 10 })

// 「牛乳 1L」だけ名前が2つに割れ、単価が無い。そこだけ1列ずれる
const TOKENS = [
  t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
  t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
  t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
  t('牛乳', 30, 690), t('1L', 60, 690), t('本', 150, 690),
  t('人参', 30, 670), t('本', 150, 670), t('90', 230, 670),
  t('白菜', 30, 650), t('玉', 150, 650), t('200', 230, 650),
]
const PAGE = { rotate: 0, tokens: TOKENS }

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
          items: TOKENS.map(k => ({ str: k.text, width: k.w, height: 10, transform: [1, 0, 0, 1, k.x, k.y] })),
        }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, ready = []

const button = (txt) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(txt))
const bodyRows = () => [...host.querySelectorAll('.gs-table tbody tr')]
  .map(tr => [...tr.children].slice(1).map(td => td.textContent.trim()))
const rowNos = () => [...host.querySelectorAll('.gs-table tbody tr .gs-no')].map(td => td.textContent.trim())

async function mount(pages = [PAGE]) {
  const { default: PdfGridSetup } = await import('./PdfGridSetup.vue')
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfGridSetup, { file, pages, onReady: (p) => ready.push(p), onClose: () => {} }),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
  button('次へ').click()
  await nextTick()
}

beforeEach(() => { ready = [] })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('PdfGridSetup — ずれを見つける', () => {
  it('行は全部出す（先頭だけ見せると、後ろのページのずれに気づけない）', async () => {
    await mount()
    expect(bodyRows().length).toBe(6)
  })

  it('そろっていない行に印を付け、件数を出す', async () => {
    await mount()
    expect(host.textContent).toContain('そろっていない行 1件')
    const marked = [...host.querySelectorAll('.gs-table tbody tr')]
      .map(tr => tr.className.includes('odd'))
    expect(marked).toEqual([false, false, false, true, false, false])
  })

  it('その行だけを見られる（行番号は全体の何行目かのまま）', async () => {
    await mount()
    button('そろっていない行').click()
    await nextTick()
    expect(bodyRows().length).toBe(1)
    expect(rowNos()).toEqual(['4'])        // 4行目であることが分かる
    expect(bodyRows()[0].slice(0, 3)).toEqual(['牛乳', '1L', '本'])
  })
})

describe('PdfGridSetup — ずれを直す', () => {
  it('「紙の位置で入れる」で、どの値も刷られている位置へ入る', async () => {
    await mount()
    expect(bodyRows()[3].slice(0, 3)).toEqual(['牛乳', '1L', '本'])   // ずれている
    button('紙の位置で入れる').click()
    await nextTick()
    expect(bodyRows()[3]).toEqual(['牛乳', '1L', '本', ''])
    expect(bodyRows()[1]).toEqual(['豚バラ', '', 'kg', '1200'])
  })

  it('割れた名前は別の列に出て、「左の列と合わせる」で元に戻る', async () => {
    await mount()
    button('紙の位置で入れる').click()
    await nextTick()
    expect(host.textContent).toContain('全 6行 / 4列')
    ;[...host.querySelectorAll('.gs-table th')][2].click()   // 2列目
    await nextTick()
    button('左の列と合わせる').click()
    await nextTick()
    expect(host.textContent).toContain('全 6行 / 3列')
    expect(bodyRows()[3]).toEqual(['牛乳 1L', '本', ''])
    expect(bodyRows()[1]).toEqual(['豚バラ', 'kg', '1200'])
  })

  it('切り替えは作り方として渡る（次に同じ紙が来ても同じように読む）', async () => {
    await mount()
    button('紙の位置で入れる').click()
    await nextTick()
    button('この表で進む').click()
    await nextTick()
    expect(ready[0].grid.byPosition).toBe(true)
  })

  it('切り替えると絞り込みは解除する（別の表になっているので引きずらない）', async () => {
    await mount()
    button('そろっていない行').click()
    await nextTick()
    expect(bodyRows().length).toBe(1)
    button('紙の位置で入れる').click()
    await nextTick()
    expect(bodyRows().length).toBe(6)
  })
})
