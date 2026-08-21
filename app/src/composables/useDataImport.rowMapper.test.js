// 過去データ取込を「読めませんでした」で行き止まりにしない（ユーザー報告）。
// 仕入先ごとに列名が違うファイルは、ヘッダ名で列を特定する既存パーサに当たらない。
// 列指定 → 中間CSVへ組み直し → 通常の取込経路へ合流、までを composable 越しに見る。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./useStore.js', () => ({
  saveMovementToD1:     vi.fn(),
  importPastSessionToD1: vi.fn(),
  cancelPastImportOnD1: vi.fn(),
}))
vi.mock('./usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  excelToCsv:            vi.fn(async () => ''),
}))

function csvFile(text, name = 'shiire.csv') {
  const file = new File([text], name, { type: 'text/csv' })
  file.text = async () => text
  return file
}

// 仕入先の様式（列名が「伝票日付 / 商品名称 / 在庫数」で、既存パーサは当てられない）
const SUPPLIER_CSV = '伝票日付,商品名称,在庫数,原価\n2026/6/1,トマト,3,120\n2026/6/1,レタス,2,80'

let di, buildMappedCSV, STOCKTAKE_FIELDS, DELIVERY_FIELDS, tokenizeCSV
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const mod   = await import('./useDataImport.js')
  const rmMod = await import('../utils/rowMapping.js')
  const csvMod = await import('../utils/csvParse.js')
  buildMappedCSV   = rmMod.buildMappedCSV
  STOCKTAKE_FIELDS = rmMod.STOCKTAKE_FIELDS
  DELIVERY_FIELDS  = rmMod.DELIVERY_FIELDS
  tokenizeCSV      = csvMod.tokenizeCSV
  di = mod.useDataImport()
})

describe('過去の棚卸', () => {
  it('自動で読めないファイルは列指定画面へ回す（alertで終わらせない）', async () => {
    const ok = await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))

    expect(ok).toBe(false)
    expect(di.showStocktakeModal.value).toBe(false)
    expect(di.stocktakePlan.value).toBeNull()
    expect(di.rowMapper.value).toMatchObject({ kind: 'stocktake', csvText: SUPPLIER_CSV, filename: 'shiire.csv' })
    // なぜ来たのかを画面へ渡す（「日付」列が要る、など元のエラーを残す）
    expect(di.rowMapper.value.message).toContain('日付')
    expect(di.rowMapper.value.fields).toStrictEqual(STOCKTAKE_FIELDS)
  })

  it('列を指定すると、通常の取込確認へ合流する', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    const csvText = buildMappedCSV(
      tokenizeCSV(SUPPLIER_CSV).rows,
      { date: 0, name: 1, qty: 2, price: 3 },
      STOCKTAKE_FIELDS, true,
    )

    const ok = await di.applyRowMapping({ csvText, filename: 'shiire.csv' })

    expect(ok).toBe(true)
    expect(di.rowMapper.value).toBeNull()
    expect(di.showStocktakeModal.value).toBe(true)
    expect(di.stocktakeFilename.value).toBe('shiire.csv')
    expect(di.stocktakePlan.value.days.map(d => d.date)).toEqual(['2026-06-01'])
    expect(di.stocktakePlan.value.days[0].items).toHaveLength(2)
    expect(di.stocktakePlan.value.rowErrors).toEqual([])
  })

  it('指定を間違えて読めなければ、また列指定へ戻る', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    // 品目名の列を日付に当ててしまった＝有効な日付が1つも無い
    const csvText = buildMappedCSV(
      tokenizeCSV(SUPPLIER_CSV).rows,
      { date: 1, name: 1, qty: 2 },
      STOCKTAKE_FIELDS, true,
    )

    const ok = await di.applyRowMapping({ csvText, filename: 'shiire.csv' })

    expect(ok).toBe(false)
    expect(di.showStocktakeModal.value).toBe(false)
    expect(di.rowMapper.value?.kind).toBe('stocktake')
    expect(di.rowMapper.value.csvText).toBe(csvText)
  })
})

describe('過去の納品', () => {
  it('取込画面から列指定へ移り、指定後に取込画面へ戻る', async () => {
    await di.openDeliveryFromFile(csvFile(SUPPLIER_CSV))
    expect(di.showDeliveryModal.value).toBe(true)   // 解析エラーはモーダル内で出る

    di.mapDeliveryColumns()
    expect(di.showDeliveryModal.value).toBe(false)
    expect(di.rowMapper.value).toMatchObject({ kind: 'delivery', csvText: SUPPLIER_CSV })
    expect(di.rowMapper.value.fields).toStrictEqual(DELIVERY_FIELDS)

    const csvText = buildMappedCSV(
      tokenizeCSV(SUPPLIER_CSV).rows,
      { date: 0, name: 1, qty: 2, price: 3 },
      DELIVERY_FIELDS, true,
    )
    const ok = await di.applyRowMapping({ csvText, filename: 'shiire.csv' })

    expect(ok).toBe(true)
    expect(di.rowMapper.value).toBeNull()
    expect(di.showDeliveryModal.value).toBe(true)
    expect(di.deliveryCsv.value).toBe(csvText)
  })
})
