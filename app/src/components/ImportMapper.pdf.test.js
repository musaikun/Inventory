/**
 * PDF由来の表を列指定しているとき、元のPDFを出せること。
 *
 * 紙を表に均してからCSVと同じ画面で当てる以上、「紙ではどう書いてあったか」を
 * その場で確かめられないと、列の当て方に確信が持てない（そこが今までの
 * 紙の上で指定する画面の取り柄だった）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      destroy: () => {},
      getPage: async () => ({
        rotate: 0,
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: [{ str: '豚バラ', width: 27, height: 10, transform: [1, 0, 0, 1, 30, 720] }] }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null

async function mount(pdfFile) {
  const { default: Mapper } = await import('./ImportMapper.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Mapper, {
      csvText: '品名,単位,単価\n豚バラ,kg,1200',
      filename: 'tanaoroshi.pdf',
      axisNames: ['', ''],
      pdfFile,
      onImported: () => {}, onClose: () => {},
    }),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
}

const btn = (t) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(t))

beforeEach(() => localStorage.clear())
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('ImportMapper — 元のPDF', () => {
  it('CSVから来た表には、元のPDFのボタンを出さない', async () => {
    await mount(null)
    expect(btn('元のPDF')).toBeUndefined()
    expect(host.querySelector('.pdfview')).toBeNull()
  })

  it('PDF由来なら、その場で元の紙を開ける（ページ送りつき）', async () => {
    const file = new File(['x'], 'tanaoroshi.pdf', { type: 'application/pdf' })
    file.arrayBuffer = async () => new ArrayBuffer(8)
    await mount(file)

    btn('元のPDF').click()
    for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }

    expect(host.querySelector('.pdfview')).not.toBeNull()
    expect(host.textContent).toContain('1 / 2')       // 複数ページを送れる
    expect(host.querySelector('canvas')).not.toBeNull()
  })
})
