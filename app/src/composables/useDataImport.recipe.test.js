/**
 * 過去データ取込（納品・棚卸）の「保存した読み方」。
 *
 * 仕入先の帳票は**毎月同じ形で来る**。2回目以降に答えることは本来1つも無いのに、
 * 覚える仕組みは品目リストの取込にしか繋がっていなかった。紙やExcelから過去の
 * 納品・棚卸を入れるたびに、同じ列指定をやり直すことになっていた。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let sessionNo = 0
vi.mock('./useStore.js', () => ({
  saveMovementToD1:      vi.fn(),
  // サーバーが sessionId を返して初めて「取り込めた」とみなされる
  importPastSessionToD1: vi.fn(async () => ({ ok: true, sessionId: `s${++sessionNo}` })),
  cancelPastImportOnD1:  vi.fn(),
}))
vi.mock('./usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  excelToCsv:            vi.fn(async () => ''),
  parsePdfFile:          vi.fn(async () => ({ pages: [] })),
}))

// 仕入先の様式（列名が「伝票日付 / 商品名称 / 在庫数」で、既存パーサは当てられない）
const SUPPLIER_CSV = '伝票日付,商品名称,在庫数,原価\n2026/6/1,トマト,3,120\n2026/6/1,レタス,2,80'
// 翌月の同じ様式（中身だけ違う）
const NEXT_MONTH   = '伝票日付,商品名称,在庫数,原価\n2026/7/1,トマト,5,130\n2026/7/1,きゅうり,4,90'

function csvFile(text, name = 'shiire_202606.csv') {
  const file = new File([text], name, { type: 'text/csv' })
  file.text = async () => text
  return file
}

let di, buildMappedCSV, STOCKTAKE_FIELDS, tokenizeCSV, fingerprintTable
beforeEach(async () => {
  localStorage.clear()
  sessionNo = 0
  vi.resetModules()
  const mod    = await import('./useDataImport.js')
  const rmMod  = await import('../utils/rowMapping.js')
  const csvMod = await import('../utils/csvParse.js')
  const recMod = await import('./importRecipes.js')
  buildMappedCSV   = rmMod.buildMappedCSV
  STOCKTAKE_FIELDS = rmMod.STOCKTAKE_FIELDS
  tokenizeCSV      = csvMod.tokenizeCSV
  fingerprintTable = recMod.fingerprintTable
  di = mod.useDataImport()
})

/** 列指定画面が返すもの（日付←伝票日付 / 品目名←商品名称 / 数量←在庫数） */
function mapped(csv) {
  const records = tokenizeCSV(csv).rows
  const mapping = { date: 0, name: 1, qty: 2 }
  return {
    csvText: buildMappedCSV(records, mapping, STOCKTAKE_FIELDS, true),
    filename: 'shiire_202606.csv',
    recipeShape: {
      kind: 'table',
      fp: fingerprintTable(records, 0),
      headerRow: 0, headerNamed: true,
      columns: [
        { field: 'date', col: 0, head: '伝票日付' },
        { field: 'name', col: 1, head: '商品名称' },
        { field: 'qty',  col: 2, head: '在庫数' },
      ],
    },
  }
}

describe('取り込んだ後に、この読み方を覚えるか訊く', () => {
  it('列指定して取り込めたら訊く。名前の見当も出す', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    await di.applyRowMapping(mapped(SUPPLIER_CSV))
    expect(di.showStocktakeModal.value).toBe(true)
    expect(di.askRecipe.value).toBeNull()          // まだ取り込んでいないので訊かない

    await di.confirmStocktakeImport()
    expect(di.askRecipe.value).not.toBeNull()
    expect(di.recipeName.value).toBe('shiire')     // 月ごとに変わる数字は落とす
  })

  it('覚えないと言えば何も残らない', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    await di.applyRowMapping(mapped(SUPPLIER_CSV))
    await di.confirmStocktakeImport()
    di.dismissRecipe()
    expect(di.askRecipe.value).toBeNull()
    expect(di.recipes.value.length).toBe(0)
  })

  it('自動で読めたファイルでは訊かない（覚えることが無い）', async () => {
    const plain = '日付,品目名,数量\n2026-06-01,トマト,3'
    await di.openStocktakeFromFile(csvFile(plain, 'export.csv'))
    await di.confirmStocktakeImport()
    expect(di.askRecipe.value).toBeNull()
  })
})

describe('覚えたら、次の月は問いが出ない', () => {
  it('同じ様式のファイルは列指定を通らずに取込確認まで進む', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    await di.applyRowMapping(mapped(SUPPLIER_CSV))
    await di.confirmStocktakeImport()
    di.recipeName.value = '○○商店 仕入'
    di.confirmSaveRecipe()
    expect(di.savedRecipe.value).toBe('○○商店 仕入')

    di.closeStocktake()
    const ok = await di.openStocktakeFromFile(csvFile(NEXT_MONTH, 'shiire_202607.csv'))
    expect(ok).toBe(true)
    expect(di.rowMapper.value).toBeNull()          // 列指定は出ない
    expect(di.showStocktakeModal.value).toBe(true)
    expect(di.matchedRecipe.value?.name).toBe('○○商店 仕入')
  })

  it('当たった回は保存を訊き直さない（もう覚えている）', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    await di.applyRowMapping(mapped(SUPPLIER_CSV))
    await di.confirmStocktakeImport()
    di.confirmSaveRecipe()
    di.closeStocktake()

    await di.openStocktakeFromFile(csvFile(NEXT_MONTH, 'shiire_202607.csv'))
    await di.confirmStocktakeImport()
    expect(di.askRecipe.value).toBeNull()
  })

  it('納品の読み方を棚卸に当てない（必要な列が同じでも別の取込）', async () => {
    await di.openStocktakeFromFile(csvFile(SUPPLIER_CSV))
    await di.applyRowMapping(mapped(SUPPLIER_CSV))
    await di.confirmStocktakeImport()
    di.confirmSaveRecipe()

    await di.openDeliveryFromFile(csvFile(NEXT_MONTH, 'shiire_202607.csv'))
    // 棚卸のレシピは使われないので、納品の確認画面は元のCSVのまま受け取る
    expect(di.matchedRecipe.value).toBeNull()
    expect(di.deliveryCsv.value).toBe(NEXT_MONTH)
  })
})
