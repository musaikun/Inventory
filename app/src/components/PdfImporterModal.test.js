// Excel の自動読み取りに当たらないフォーマットを行き止まりにしない（ユーザー報告）。
// PDF には「列を指定して読み取る」があるのに、Excel は
// 「品目が見つかりませんでした。ファイルの形式を確認してください」で終わっていた。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let excelItems = []

vi.mock('../composables/usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  parseExcelFile:  vi.fn(async () => excelItems),
  parsePdfFile:    vi.fn(async () => ({ items: [], debugLines: [], pages: [] })),
  itemsToConfigCSV: vi.fn(() => ''),
}))
vi.mock('../utils/pdfTableParser.js', () => ({ extractRows: vi.fn(() => []) }))
vi.mock('../composables/pdfProfiles.js', () => ({ matchProfile: vi.fn(() => null) }))

let app = null
let host = null
let mapped = []

async function mountWithExcel() {
  const { default: PdfImporterModal } = await import('./PdfImporterModal.vue')
  const file = new File(['x'], 'shiire.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfImporterModal, {
      initialFile: file,
      onClose: () => {},
      onMapColumns: (f) => mapped.push(f),
    }),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) await nextTick()
  return file
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}

describe('PdfImporterModal — Excel の受け皿', () => {
  beforeEach(() => { excelItems = []; mapped = [] })
  afterEach(() => {
    app?.unmount(); host?.remove()
    app = null; host = null
    vi.resetModules()
  })

  it('読み取れなかったExcelから列指定インポートへ渡せる', async () => {
    const file = await mountWithExcel()
    expect(host.textContent).toContain('自動では読み取れませんでした')
    expect(host.textContent).not.toContain('ファイルの形式を確認してください')

    button('列を指定して取り込む').click()
    await nextTick()
    expect(mapped).toEqual([file])
  })

  it('自動で読み取れたExcelでも、列指定へ切り替えられる', async () => {
    excelItems = [{ name: 'トマト', unit: '箱', category: '', code: '', packQty: '', prevMonth: '' }]
    await mountWithExcel()
    expect(host.textContent).toContain('1件の品目を検出')
    expect(button('列を指定して取り込む')).not.toBeUndefined()
  })
})
