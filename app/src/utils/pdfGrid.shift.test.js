/**
 * 「この行だけ1列ずれている」を直せるようにする。
 *
 * 紙から組んだ表でいちばん質の悪い壊れ方がこれ。他の行は正しいので、**先頭を見ただけでは
 * 気づけない**。しかも何ページもある紙で、確かめられるのが1ページ目だけだと、
 * 後ろでずれていても最後まで分からない。
 *
 * 起きる理由は、セルの数が多数派と同じでも中身の並びが違う行があるから。
 * 品目名に空白があって2つに割れ、かわりに値が1つ欠けると、数はそろったまま
 * 全部が1つずつ右へ寄る。
 */
import { describe, it, expect } from 'vitest'
import { pdfPagesToRows, oddRowIndexes } from './pdfGrid.js'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6, h: 10 })

// 「牛乳 1L」だけ名前が2つに割れ、単価が無い紙
const PAGE = {
  rotate: 0,
  tokens: [
    t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
    t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
    t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
    t('牛乳', 30, 690), t('1L', 60, 690), t('本', 150, 690),
    t('人参', 30, 670), t('本', 150, 670), t('90', 230, 670),
  ],
}

describe('並び順で入れると、その行だけずれる', () => {
  it('数はそろっているのに、単位の列に大きさ・単価の列に単位が入る', () => {
    const rows = pdfPagesToRows([PAGE])
    expect(rows[3]).toEqual(['牛乳', '1L', '本'])   // ← ずれている行
    expect(rows[1]).toEqual(['豚バラ', 'kg', '1200'])
  })
})

describe('位置で入れる（byPosition）', () => {
  it('どの値も紙に刷られているところへ入る（欠けたところは空のまま）', () => {
    const rows = pdfPagesToRows([PAGE], { byPosition: true })
    expect(rows[3]).toEqual(['牛乳', '1L', '本', ''])
    expect(rows[1]).toEqual(['豚バラ', '', 'kg', '1200'])
  })

  it('割れた名前は別の列に出る（「左の列と合わせる」でまとめられる）', () => {
    const rows = pdfPagesToRows([PAGE], { byPosition: true })
    expect(rows[0].length).toBe(4)
    // 2列目は割れた名前の右半分だけ。ここを左と合わせれば元に戻る
    expect(rows.map(r => r[1])).toEqual(['', '', '', '1L', ''])
  })

  it('合わせたあとは、ずれのない3列の表になる', () => {
    const { pdfPagesToTable } = { pdfPagesToTable: null } // 読みやすさのための目印
    const auto = pdfPagesToRows([PAGE], { byPosition: true })
    expect(auto[0].length).toBe(4)
    // 画面の「左の列と合わせる」は境界を1本消す。ここではその結果を直接確かめる
    const merged = pdfPagesToRows([PAGE], { byPosition: true, edges: [111, 199] })
    expect(merged[3]).toEqual(['牛乳 1L', '本', ''])
    expect(merged[1]).toEqual(['豚バラ', 'kg', '1200'])
  })

  it('ずれていない紙では、列の数も中身も変わらない', () => {
    const clean = { rotate: 0, tokens: PAGE.tokens.filter(k => k.text !== '1L') }
    expect(pdfPagesToRows([clean], { byPosition: true }))
      .toEqual(pdfPagesToRows([clean]))
  })
})

describe('oddRowIndexes — ずれを目で探させない', () => {
  it('値の数が多数派と違う行を拾う', () => {
    const rows = [
      ['品名', '単位', '単価'],
      ['豚バラ', 'kg', '1200'],
      ['キャベツ', '玉', '280'],
      ['牛乳 1L', '', '本'],       // 1つ少ない
      ['人参', '本', '90'],
    ]
    expect(oddRowIndexes(rows)).toEqual([3])
  })

  it('数がそろっていても、数字の列に数字でない値があれば拾う', () => {
    const rows = [
      ['品名', '単位', '単価'],
      ['豚バラ', 'kg', '1200'],
      ['キャベツ', '玉', '280'],
      ['牛乳', '1L', '本'],        // 数はそろっているが単価の列が文字
      ['人参', '本', '90'],
      ['白菜', '玉', '200'],
    ]
    expect(oddRowIndexes(rows)).toEqual([3])
  })

  it('見出しの行は拾わない（印が意味を失う）', () => {
    const rows = [
      ['品名', '単位', '単価'],
      ['豚バラ', 'kg', '1200'],
      ['キャベツ', '玉', '280'],
      ['人参', '本', '90'],
    ]
    expect(oddRowIndexes(rows)).toEqual([])
  })

  it('見出しから足した列は見ない（全行同じ値なので判定を狂わせる）', () => {
    const rows = [
      ['品名', '単位', '単価', '冷凍'],
      ['豚バラ', 'kg', '1200', '冷凍'],
      ['キャベツ', '玉', '280', '冷凍'],
      ['牛乳 1L', '', '本', '冷凍'],
      ['人参', '本', '90', '冷凍'],
    ]
    expect(oddRowIndexes(rows, { ignoreRight: 1 })).toEqual([3])
  })

  it('行が少なすぎるときは何も言わない（多数派が決まらない）', () => {
    expect(oddRowIndexes([['a', 'b'], ['c', 'd']])).toEqual([])
  })
})
