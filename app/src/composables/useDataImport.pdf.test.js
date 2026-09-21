/**
 * 紙の納品書・棚卸表（PDF）を、過去データの取込へ流す。
 *
 * 品目リストの取込にはPDFの入口があったのに、**過去の納品・棚卸には無かった**。
 * 紙でしか残っていない過去のデータが、そもそも入れられない状態だった。
 *
 * PDFだけはそのままCSVにできない ── 何枚の表が刷られているか・行の高さ・列の境界を
 * 人が決めて初めて表になる。そこを通したあとは、CSV・Excel とまったく同じ経路へ合流する。
 * 自動で読めなければ列指定へ落ちるので、紙の帳票でも行き止まりにならない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./useStore.js', () => ({
  saveMovementToD1:      vi.fn(),
  importPastSessionToD1: vi.fn(),
  cancelPastImportOnD1:  vi.fn(),
}))

const PAGES = [{ rotate: 0, tokens: [{ text: '品名', x: 30, y: 750, w: 12, h: 10 }] }]
let parsed = { pages: PAGES }
vi.mock('./usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  excelToCsv:            vi.fn(async () => ''),
  parsePdfFile:          vi.fn(async () => parsed),
}))

function pdfFile(name = 'nouhin.pdf') {
  const file = new File(['x'], name, { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  return file
}

// 表に均したあとのCSV。納品・棚卸の中間フォーマットに合う形
const GOOD_CSV = '日付,品目名,数量\n2026-06-01,トマト,3\n2026-06-01,レタス,2'
// 仕入先の様式（既存パーサは当てられない）
const ODD_CSV  = '伝票日付,商品名称,在庫数\n2026/6/1,トマト,3'

let di, alerts
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  parsed = { pages: PAGES }
  alerts = []
  globalThis.alert = (m) => alerts.push(m)
  const mod = await import('./useDataImport.js')
  di = mod.useDataImport()
})

describe('PDFを開いたところでは、まだ何も取り込まない', () => {
  it('過去の棚卸: 表にする画面のためのページを持つだけ', async () => {
    await di.openStocktakeFromFile(pdfFile())
    expect(di.pdfSetup.value).toMatchObject({ kind: 'stocktake' })
    expect(di.pdfSetup.value.pages).toStrictEqual(PAGES)
    expect(di.showStocktakeModal.value).toBe(false)
    expect(di.rowMapper.value).toBeNull()
  })

  it('過去の納品: 同じく、確認画面はまだ開かない', async () => {
    await di.openDeliveryFromFile(pdfFile())
    expect(di.pdfSetup.value).toMatchObject({ kind: 'delivery' })
    expect(di.showDeliveryModal.value).toBe(false)
  })

  it('やめれば何も起きない', async () => {
    await di.openStocktakeFromFile(pdfFile())
    di.closePdfSetup()
    expect(di.pdfSetup.value).toBeNull()
    expect(di.showStocktakeModal.value).toBe(false)
  })
})

describe('表にしたあとは、CSV・Excel と同じ経路へ合流する', () => {
  it('過去の棚卸: 読めるCSVなら取込確認へ', async () => {
    await di.openStocktakeFromFile(pdfFile())
    const ok = await di.applyPdfSetup({ csvText: GOOD_CSV })
    expect(ok).toBe(true)
    expect(di.pdfSetup.value).toBeNull()
    expect(di.showStocktakeModal.value).toBe(true)
    expect(di.stocktakeFilename.value).toBe('nouhin.pdf')
  })

  it('過去の棚卸: 自動で読めなければ列指定へ落ちる（紙でも行き止まりにしない）', async () => {
    await di.openStocktakeFromFile(pdfFile())
    const ok = await di.applyPdfSetup({ csvText: ODD_CSV })
    expect(ok).toBe(false)
    expect(di.rowMapper.value).toMatchObject({ kind: 'stocktake', csvText: ODD_CSV, filename: 'nouhin.pdf' })
  })

  it('過去の納品: 表にしたCSVをそのまま確認画面へ渡す', async () => {
    await di.openDeliveryFromFile(pdfFile('01.pdf'))
    const ok = await di.applyPdfSetup({ csvText: GOOD_CSV })
    expect(ok).toBe(true)
    expect(di.showDeliveryModal.value).toBe(true)
    expect(di.deliveryCsv.value).toBe(GOOD_CSV)
    expect(di.deliveryFilename.value).toBe('01.pdf')
  })
})

describe('読み取れないPDF', () => {
  it('文字が1つも取れない紙は、そう言って止める（空の表を作らない）', async () => {
    parsed = { pages: [] }
    const ok = await di.openStocktakeFromFile(pdfFile())
    expect(ok).toBe(false)
    expect(di.pdfSetup.value).toBeNull()
    expect(alerts.join()).toContain('文字を取り出せませんでした')
  })
})
