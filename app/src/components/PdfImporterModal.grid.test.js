/**
 * PDFの列指定を、CSV・Excel と同じ画面（ImportMapper）へ渡すまで。
 *
 * PDFだけが「紙の上の文字をタップして列を作る」別の操作だった。ここで確かめるのは、
 * 自動で読めなかったPDFが **表に均されて列指定へ渡ること**と、
 * そのとき**元のPDFも一緒に渡ること**（表になった姿と紙を見比べられないと、
 * 列の当て方に確信が持てない）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

// 1段の表。x=30 品名 / x=150 単位 / x=220 単価
const TOKENS = [
  { text: '品名', x: 30, y: 750, w: 18 }, { text: '単位', x: 150, y: 750, w: 18 }, { text: '単価', x: 220, y: 750, w: 18 },
  { text: '豚バラ', x: 30, y: 720, w: 27 }, { text: 'kg', x: 150, y: 720, w: 12 }, { text: '1200', x: 220, y: 720, w: 24 },
]

vi.mock('../composables/usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  parseExcelFile:  vi.fn(async () => []),
  // 自動では1件も読めなかったPDF（＝列指定へ回る紙）
  parsePdfFile:    vi.fn(async () => ({ items: [], debugLines: ['x'], pages: [{ tokens: TOKENS, rotate: 0 }] })),
  itemsToConfigCSV: vi.fn(() => ''),
}))

// PdfPageViewer が開くPDF（描画はしない。表示できることだけ）
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
          items: TOKENS.map(t => ({ str: t.text, width: t.w, height: 10, transform: [1, 0, 0, 1, t.x, t.y] })),
        }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, mapped = []
const button = (t) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(t))

async function mount() {
  const { default: PdfImporterModal } = await import('./PdfImporterModal.vue')
  const file = new File(['x'], 'tanaoroshi_2026-04.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfImporterModal, {
      initialFile: file,
      onClose: () => {},
      onMapColumns: (p) => mapped.push(p),
    }),
  })
  app.mount(host)
  for (let i = 0; i < 14; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
  return file
}

beforeEach(() => { mapped = []; localStorage.clear() })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('PdfImporterModal — PDFを表にして列指定へ渡す', () => {
  it('自動で読めなかったPDFは、まず「表は何枚か」を訊く', async () => {
    await mount()
    expect(host.textContent).toContain('この紙、表は何枚ありますか？')
    expect(host.querySelectorAll('.gs-btn').length).toBe(4)
  })

  it('枚数に答えると、組み上がった表をその場で見せる（渡す前に確かめられる）', async () => {
    await mount()
    host.querySelectorAll('.gs-btn')[0].click()   // 1枚
    await nextTick()

    expect(mapped.length).toBe(0)                 // まだ渡さない
    expect(host.textContent).toContain('豚バラ')
    expect(host.textContent).toContain('全 2行 / 3列')
  })

  it('「この表で進む」で、表にしたCSV・元のPDF・表の作り方が列指定画面へ渡る', async () => {
    const file = await mount()
    host.querySelectorAll('.gs-btn')[0].click()
    await nextTick()
    button('この表で進む').click()
    await nextTick()

    expect(mapped.length).toBe(1)
    const payload = mapped[0]
    expect(payload.csvText.split('\r\n')).toEqual(['品名,単位,単価', '豚バラ,kg,1200'])
    expect(payload.filename).toBe('tanaoroshi_2026-04.pdf')
    expect(payload.pdfFile).toBe(file)            // 列を当てる画面から元の紙を見られる
    expect(payload.pdf.grid.sections).toBe(1)     // この作り方がレシピに残る
    expect(payload.pdf.grid.edges.length).toBe(2) // 3列＝境界2本
  })

  it('列がくっついていたら、その場で分けられる（直した内容は作り方として渡る）', async () => {
    await mount()
    host.querySelectorAll('.gs-btn')[0].click()
    await nextTick()

    // 1列目を選んで「合わせる」→ 2列になり、境界は1本
    ;[...host.querySelectorAll('.gs-table th')][2].click()   // 2列目（先頭は行番号の列）
    await nextTick()
    button('左の列と合わせる').click()
    await nextTick()
    expect(host.textContent).toContain('全 2行 / 2列')

    button('この表で進む').click()
    await nextTick()
    expect(mapped[0].csvText.split('\r\n')[1]).toBe('豚バラ kg,1200')
    expect(mapped[0].pdf.grid.edges.length).toBe(1)
  })

  it('作り方を覚えたレシピが当たると、問いを出さずにそのまま列指定へ渡す', async () => {
    const { saveRecipe, fingerprintPdf } = await import('../composables/importRecipes.js')
    saveRecipe({
      name: '○○商店 仕入表', kind: 'table',
      fp: { kind: 'table', cols: 3, headerRow: 0, head: ['品名', '単位', '単価'], shape: [] },
      pdfFp: fingerprintPdf(TOKENS),
      grid: { sections: 1, rowFactor: 0.5, edges: [] },
      columns: [],
    })

    await mount()
    expect(host.textContent).not.toContain('この紙、表は何枚ありますか？')
    expect(mapped.length).toBe(1)
    expect(mapped[0].csvText.split('\r\n')[1]).toBe('豚バラ,kg,1200')
  })

  it('紙の上で直接指定する道も残っている', async () => {
    await mount()
    host.querySelectorAll('.gs-btn')[0].click()
    await nextTick()
    const btn = button('紙の上で直接指定する')
    expect(btn).not.toBeUndefined()
    btn.click()
    await nextTick()
    expect(host.textContent).toContain('列を指定して読み取る')
  })
})
