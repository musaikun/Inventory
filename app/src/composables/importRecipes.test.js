/**
 * 取込レシピ。同じ帳票は毎月同じ形で来るので、2回目以降に人が答えることは
 * 本来1つも無い。ここが崩れると、毎回ゼロから問いに答え直すことになる。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listRecipes, saveRecipe, deleteRecipe, renameRecipe, matchRecipe,
  fingerprintTable, fingerprintPdf, applyRecipeColumns, suggestRecipeName,
} from './importRecipes.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const rows = (arr) => arr.map((cols, i) => ({ line: i + 1, cols }))
const HEAD = ['商品ｺｰﾄﾞ', '商品名', '分類', '単位', '仕入単価']
const FILE = rows([HEAD, ['12687', 'サラダ用カップ', '資材', '個', '20']])

beforeEach(() => localStorage.clear())

describe('表の指紋', () => {
  it('見出しの名前の集合で当てる（字形の違いは吸収する）', () => {
    const fp = fingerprintTable(FILE, 0)
    saveRecipe({ name: '仕入先マスタ', kind: 'table', fp, columns: [] })
    // 来月の同じ帳票（中身は違う・見出しは同じ）
    const next = rows([['商品コード', '商品名', '分類', '単位', '仕入単価'],
                       ['99', 'コーヒー豆', '飲料', 'kg', '1800']])
    expect(matchRecipe(fingerprintTable(next, 0))?.name).toBe('仕入先マスタ')
  })

  it('列数が違うファイルには当たらない', () => {
    saveRecipe({ name: 'A', kind: 'table', fp: fingerprintTable(FILE, 0), columns: [] })
    const other = rows([['日付', '品名', '数量'], ['2026-08-01', 'トマト', '3']])
    expect(matchRecipe(fingerprintTable(other, 0))).toBeNull()
  })

  it('見出しの無いファイルは列の形（文字/数字/空）で当てる', () => {
    const noHead = rows([['豚バラ', 'kg', '1200'], ['鶏もも', 'kg', '980']])
    saveRecipe({ name: '発注書', kind: 'table', fp: fingerprintTable(noHead, -1), columns: [] })
    const next = rows([['キャベツ', '個', '280']])
    expect(matchRecipe(fingerprintTable(next, -1))?.name).toBe('発注書')
    // 形が違えば当たらない
    const shaped = rows([['1', '2', '3']])
    expect(matchRecipe(fingerprintTable(shaped, -1))).toBeNull()
  })
})

describe('列の当てはめ', () => {
  it('列が動いていても見出しの名前で追える', () => {
    // 保存時は 商品名=1 だったが、来月のファイルでは 商品名=2 に動いている
    const recipe = {
      name: 'x', kind: 'table', fp: fingerprintTable(FILE, 0),
      columns: [{ field: 'name', col: 1, head: '商品名' }, { field: 'price', col: 4, head: '仕入単価' }],
    }
    const moved = ['メモ', '商品ｺｰﾄﾞ', '商品名', '分類', '単位', '仕入単価']
    expect(applyRecipeColumns(recipe, moved)).toEqual({ name: 2, price: 5 })
  })

  it('見出しが無いファイルは列番号で当てる', () => {
    const recipe = { name: 'x', kind: 'table', columns: [{ field: 'name', col: 0, head: '' }] }
    expect(applyRecipeColumns(recipe, [])).toEqual({ name: 0 })
  })

  it('いまのファイルに無い列は落とす（存在しない列を指さない）', () => {
    const recipe = { name: 'x', kind: 'table', columns: [{ field: 'price', col: 9, head: '単価' }] }
    expect(applyRecipeColumns(recipe, ['品名', '単位'])).toEqual({})
  })
})

describe('保存・削除・名前', () => {
  it('同じ紙のレシピは置き換える（2枚あるとどちらが当たったか分からない）', () => {
    const fp = fingerprintTable(FILE, 0)
    saveRecipe({ name: '古い名前', kind: 'table', fp, columns: [] })
    saveRecipe({ name: '新しい名前', kind: 'table', fp, columns: [] })
    expect(listRecipes()).toHaveLength(1)
    expect(listRecipes()[0].name).toBe('新しい名前')
  })

  it('別の紙は増える。削除・名前変更ができる', () => {
    const a = saveRecipe({ name: 'A', kind: 'table', fp: fingerprintTable(FILE, 0), columns: [] })
    const other = rows([['日付', '品名', '数量'], ['2026-08-01', 'トマト', '3']])
    saveRecipe({ name: 'B', kind: 'table', fp: fingerprintTable(other, 0), columns: [] })
    expect(listRecipes()).toHaveLength(2)
    renameRecipe(a.id, 'A2')
    expect(listRecipes().find(r => r.id === a.id).name).toBe('A2')
    deleteRecipe(a.id)
    expect(listRecipes().map(r => r.name)).toEqual(['B'])
  })

  it('ファイル名から名前の見当を作る（年月を落とす）', () => {
    expect(suggestRecipeName('仕入先マスタ_2026.csv')).toBe('仕入先マスタ')
    expect(suggestRecipeName('202708_棚卸記入表.pdf')).toBe('棚卸記入表')
    expect(suggestRecipeName('東西酒販.csv')).toBe('東西酒販')
  })
})

describe('PDFレシピ', () => {
  it('トークンのx座標で当てる（従来と同じ）', () => {
    const items = [{ text: '品名', x: 30, y: 750 }, { text: '単価', x: 155, y: 750 }]
    saveRecipe({ name: 'PDF', kind: 'pdf', fp: fingerprintPdf(items), columns: [], fromY: 750 })
    expect(matchRecipe(fingerprintPdf(items))?.name).toBe('PDF')
    expect(matchRecipe(fingerprintTable(FILE, 0))).toBeNull()   // 経路が違えば当たらない
  })

  it('旧 pdfProfiles に保存済みのレシピを引き継ぐ', () => {
    localStorage.setItem(STORAGE_KEYS.pdfProfiles, JSON.stringify([{
      id: 'pf_1', name: '東西酒販', createdAt: '2026-08-01T00:00:00.000Z',
      fingerprint: [32, 156],   // x=30,155 を4px粒度で丸めた値 columns: [{ field: 'name', x: 30 }, { field: 'price', x: 155 }], fromY: 750,
    }]))
    const got = listRecipes()
    expect(got.map(r => r.name)).toEqual(['東西酒販'])
    expect(got[0].fp).toEqual({ kind: 'pdf', x: [32, 156] })
    // 引き継いだレシピが、これまでどおり当たる
    const items = [{ text: '品名', x: 30, y: 750 }, { text: '単価', x: 155, y: 750 }]
    expect(matchRecipe(fingerprintPdf(items))?.name).toBe('東西酒販')
  })
})
