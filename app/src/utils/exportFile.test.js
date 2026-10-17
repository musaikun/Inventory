// 表 → ファイル（2026-10-17）。Excel で書いたものも、読み戻してもこのアプリの形と分かること
import { describe, it, expect } from 'vitest'
import { sheetsToCsv, sheetsToXlsx } from './exportFile.js'
import { ownItemMapping } from './itemImport.js'

describe('書き出しのファイル', () => {
  it('CSV: 同じ見出しのシートは1つにつなげ、= で始まる文字は止める', () => {
    const csv = sheetsToCsv([
      { name: 'a', rows: [['日付', '品目名'], ['2026-10-01', '=1+1']] },
      { name: 'b', rows: [['日付', '品目名'], ['2026-10-02', 'キャベツ']] },
    ])
    expect(csv.split('\r\n')).toEqual(['日付,品目名', `2026-10-01,'=1+1`, '2026-10-02,キャベツ'])
  })

  it('Excel: シートごと。数は数のまま。読み戻すとこのアプリの品目リストと分かる', async () => {
    const XLSX = await import('xlsx')
    const head = ['品目名', '単位', '単価', 'カテゴリ', 'エイリアス', '商品コード', '分類コード', '前月実績', '入数', '保管場所', '仕入先', '発注点']
    const buf = await sheetsToXlsx([{ name: '品目リスト', rows: [head, ['キャベツ', '玉', 180, '野菜', '', '', '', '', '', '', '', 3]] }])
    const wb = XLSX.read(buf, { type: 'array' })
    expect(wb.SheetNames).toEqual(['品目リスト'])
    expect(wb.Sheets['品目リスト'].C2.v).toBe(180)
    expect(wb.Sheets['品目リスト'].C2.t).toBe('n')
    // 取り込みは Worker で sheet_to_csv する（excelToCsv）。ここでは同じ変換で確かめる
    expect(ownItemMapping(XLSX.utils.sheet_to_csv(wb.Sheets['品目リスト']))).not.toBeNull()
  })
})
