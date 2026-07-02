import { describe, it, expect } from 'vitest'
import { parseResultCSV, isResultCSV } from './resultCsvParser.js'

const CSV_PRICED = [
  '日付,商品コード,品目名,単位,数量,単価,在庫金額',
  '"2026-06-30","4900000000001","豚バラ","kg",3,500,1500',
  '"2026-06-30","","ビール","本",24,200,4800',
  '"2026-06-30","","【合計】","",,,6300',
].join('\r\n')

const CSV_NOPRICE = [
  '日付,商品コード,品目名,単位,数量',
  '"2026-06-30","","牛乳","本",5',
  '"2026-06-30","","空き品",,',   // 数量空 → スキップ
].join('\r\n')

describe('resultCsvParser', () => {
  describe('isResultCSV', () => {
    it('品目名＋数量列があれば true', () => {
      expect(isResultCSV(CSV_PRICED)).toBe(true)
      expect(isResultCSV(CSV_NOPRICE)).toBe(true)
    })
    it('品目リストCSV（数量なし）は false', () => {
      expect(isResultCSV('品目名,単位,単価\n豚バラ,kg,500')).toBe(false)
    })
    it('空文字は false', () => {
      expect(isResultCSV('')).toBe(false)
    })
  })

  describe('parseResultCSV', () => {
    it('品目名・数量・単位・コード・単価を抽出する', () => {
      const rows = parseResultCSV(CSV_PRICED)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({ name: '豚バラ', qty: 3, unit: 'kg', code: '4900000000001', price: 500, category: '', lotSize: '', prevMonth: '' })
      expect(rows[1]).toEqual({ name: 'ビール', qty: 24, unit: '本', code: '', price: 200, category: '', lotSize: '', prevMonth: '' })
    })

    it('【合計】行はスキップする', () => {
      const rows = parseResultCSV(CSV_PRICED)
      expect(rows.find(r => r.name.includes('合計'))).toBeUndefined()
    })

    it('数量が空の行はスキップする', () => {
      const rows = parseResultCSV(CSV_NOPRICE)
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('牛乳')
      expect(rows[0].qty).toBe(5)
      expect(rows[0].price).toBeNull()
    })

    it('列順が違っても（ヘッダ名で特定）動く', () => {
      const csv = ['品目名,数量,単位\nトマト,8,個'].join('\n')
      const rows = parseResultCSV(csv)
      expect(rows[0]).toMatchObject({ name: 'トマト', qty: 8, unit: '個' })
    })

    it('品目名/数量列が無ければエラー', () => {
      expect(() => parseResultCSV('品目名,単位\n豚バラ,kg')).toThrow()
    })

    it('数量データが無ければエラー', () => {
      expect(() => parseResultCSV('品目名,数量\n豚バラ,\nビール,')).toThrow()
    })
  })
})
