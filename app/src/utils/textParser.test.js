import { describe, it, expect } from 'vitest'
import { parseLine, parseInventoryText, normalizeUnit } from './textParser.js'

describe('textParser', () => {
  describe('parseLine', () => {
    it('「品目名 数量単位」を分解する', () => {
      expect(parseLine('豚バラ　3kg')).toEqual({ name: '豚バラ', qty: 3, unit: 'kg', selected: true })
    })

    it('数量と単位が離れていても取り込む', () => {
      expect(parseLine('ビール 24 本')).toEqual({ name: 'ビール', qty: 24, unit: '本', selected: true })
    })

    it('小数の数量に対応', () => {
      expect(parseLine('牛乳 1.5L')).toEqual({ name: '牛乳', qty: 1.5, unit: 'L', selected: true })
    })

    it('単位の正規化（l→L, ml→ml）', () => {
      expect(parseLine('水 2l').unit).toBe('L')
      expect(parseLine('醤油 500ml').unit).toBe('ml')
    })

    it('数量なしでも品目名だけ返す（qty=null）', () => {
      expect(parseLine('トマト')).toEqual({ name: 'トマト', qty: null, unit: '', selected: true })
    })

    it('空行・区切り線は null', () => {
      expect(parseLine('')).toBeNull()
      expect(parseLine('-----')).toBeNull()
      expect(parseLine('───────')).toBeNull()
    })

    it('ヘッダー行はスキップ', () => {
      expect(parseLine('品目名 数量 単位')).toBeNull()
      expect(parseLine('商品名')).toBeNull()
    })

    it('金額表記は除去される', () => {
      // ¥1,200 や 1200円 は名前に混ざらない
      expect(parseLine('トマト 5個 ¥1,200')).toEqual({ name: 'トマト', qty: 5, unit: '個', selected: true })
      expect(parseLine('合計 ¥5,000')).toBeNull()
    })

    it('数量以降のトークンは品目名に含めない', () => {
      // 数量の後ろの余計な語を名前に巻き込まない
      const r = parseLine('国産 鶏もも 2kg 冷蔵')
      expect(r.name).toBe('国産鶏もも')
      expect(r.qty).toBe(2)
      expect(r.unit).toBe('kg')
    })
  })

  describe('parseInventoryText', () => {
    it('複数行から抽出できた行だけ返す', () => {
      const text = [
        '発注書',          // ヘッダー語ではないが品目扱いになるので件数に注意
        '豚バラ 3kg',
        '------',
        'ビール 24本',
        '',
        '合計 ¥10,000',
      ].join('\n')
      const rows = parseInventoryText(text)
      const names = rows.map(r => r.name)
      expect(names).toContain('豚バラ')
      expect(names).toContain('ビール')
      expect(names).not.toContain('合計')
    })

    it('空文字なら空配列', () => {
      expect(parseInventoryText('')).toEqual([])
      expect(parseInventoryText(null)).toEqual([])
    })
  })

  describe('normalizeUnit', () => {
    it('l→L, ml→ml, その他はそのまま', () => {
      expect(normalizeUnit('l')).toBe('L')
      expect(normalizeUnit('ML')).toBe('ml')
      expect(normalizeUnit('箱')).toBe('箱')
      expect(normalizeUnit('')).toBe('')
    })
  })
})
