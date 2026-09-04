// 取込の「文字の読み方」。実運用の帳票は半角カナで書かれるので、
// 字形をそろえずに突き合わせると、読めている列が「無い列」になる。
import { describe, it, expect } from 'vitest'
import { normText, normHeader, headerMatches, isMetaName, metaReason } from './importText.js'

describe('normHeader', () => {
  it('半角カナ・全角英数・大小・空白の違いを消す', () => {
    expect(normHeader('商品ｺｰﾄﾞ')).toBe('商品コード')
    expect(normHeader('ＰＲＩＣＥ')).toBe('price')
    expect(normHeader('  単 価 ')).toBe('単価')
  })
  it('normText は大小をそのままにする（品目名の表示を壊さない）', () => {
    expect(normText('ｷｯｻｶﾊﾞTｼｬﾂ')).toBe('キッサカバTシャツ')
  })
})

describe('headerMatches', () => {
  it('実物の見出し（半角カナ）がヒントに当たる', () => {
    expect(headerMatches('商品ｺｰﾄﾞ', ['商品コード', 'コード'])).toBe(true)
    expect(headerMatches('仕入単価', ['単価', 'price'])).toBe(true)
  })
  it('当たらないものは当たらない', () => {
    expect(headerMatches('備考', ['単価', 'price'])).toBe(false)
    expect(headerMatches('', ['単価'])).toBe(false)
  })
})

describe('isMetaName', () => {
  it('品目ではない行を見分ける', () => {
    for (const n of ['小計', '合計', '【野菜】', '（飲料）', '品名', '発行日', 'ページ 1', '', '  ']) {
      expect(isMetaName(n), n).toBe(true)
    }
  })
  it('ふつうの品目は落とさない', () => {
    for (const n of ['キャベツ', '豚バラ', 'ｷｯｻｶﾊﾞTｼｬﾂ', '合鴨ロース', '小松菜']) {
      expect(isMetaName(n), n).toBe(false)
    }
  })
  it('理由を人の言葉で返す（戻す判断ができるように）', () => {
    expect(metaReason('小計')).toContain('小計')
    expect(metaReason('【野菜】')).toContain('区分')
    expect(metaReason('品名')).toContain('列の名前')
  })
})
