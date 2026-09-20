/**
 * 紙の見出しにしか書いていない情報を、列に変える。
 *
 * 帳票には「○○店　○月　冷凍」のように、**そのページの品目ぜんぶに効く情報が
 * 1ヵ所だけ**書かれていることがある。品目の行には無いので、表に均しただけでは落ちる。
 * ここを列に変えてしまえば、以降はCSV・Excel とまったく同じ経路で扱える
 * （`pdfGrid` 自体と同じ考え方）。
 *
 * 覚えるのは**値ではなく位置**。「○月」は翌月変わるので、値を焼き付けると使えない。
 */
import { describe, it, expect } from 'vitest'
import { pdfPagesToTable, pdfPagesToRows, pageHeads } from './pdfGrid.js'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6, h: 10 })

/** 見出し帯（y=790）＋ 表（y=750..）。分類は見出しに1ヵ所だけ */
const page = (bunrui) => ({
  rotate: 0,
  tokens: [
    t('○○店', 30, 790), t('4月', 120, 790), t(bunrui, 200, 790),
    t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
    t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
    t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
  ],
})
const FROZEN = page('冷凍')
const DRY    = page('乾物')
const BUNRUI = { x: 200, y: 790 }

describe('pageHeads — 見出し帯の語', () => {
  it('表の1行目より上だけを候補にする（品目の行を混ぜない）', () => {
    expect(pageHeads([FROZEN])[0].map(k => k.text)).toEqual(['○○店', '4月', '冷凍'])
  })

  it('ページごとに返す（1ページ目=冷凍 / 2ページ目=乾物）', () => {
    const heads = pageHeads([FROZEN, DRY])
    expect(heads.length).toBe(2)
    expect(heads[1].map(k => k.text)).toContain('乾物')
  })

  it('見出し帯の無い紙では空（当てずっぽうの候補を出さない）', () => {
    const bare = { rotate: 0, tokens: FROZEN.tokens.filter(k => k.y < 780) }
    expect(pageHeads([bare])[0]).toEqual([])
  })
})

describe('pdfPagesToTable — 見出しから足す列', () => {
  it('全行の右端に、その語が入る（見出しの行にも入るので列の名前になる）', () => {
    const rows = pdfPagesToRows([FROZEN], { heads: [BUNRUI] })
    expect(rows).toEqual([
      ['品名', '単位', '単価', '冷凍'],
      ['豚バラ', 'kg', '1200', '冷凍'],
      ['キャベツ', '玉', '280', '冷凍'],
    ])
  })

  it('ページごとに値が変わる（分類が混ざらない）', () => {
    const rows = pdfPagesToRows([FROZEN, DRY], { heads: [BUNRUI] })
    expect(rows.map(r => r[3])).toEqual(['冷凍', '冷凍', '冷凍', '乾物', '乾物', '乾物'])
  })

  it('覚えるのは位置。値が変わっても同じところから読む（翌月の紙）', () => {
    const nextMonth = {
      rotate: 0,
      tokens: FROZEN.tokens.map(k => (k.text === '4月' ? { ...k, text: '5月' } : k)),
    }
    const rows = pdfPagesToRows([nextMonth], { heads: [{ x: 120, y: 790 }] })
    expect(rows[1][3]).toBe('5月')
  })

  it('覚えた位置に何も無いページは空にする（近くの別の語を拾わない）', () => {
    const noBunrui = { rotate: 0, tokens: FROZEN.tokens.filter(k => k.text !== '冷凍') }
    const rows = pdfPagesToRows([noBunrui], { heads: [BUNRUI] })
    expect(rows.every(r => r[3] === '')).toBe(true)
  })

  it('2つ以上足せる（店名と分類）', () => {
    const rows = pdfPagesToRows([FROZEN], { heads: [{ x: 30, y: 790 }, BUNRUI] })
    expect(rows[1]).toEqual(['豚バラ', 'kg', '1200', '○○店', '冷凍'])
  })

  it('足した列の位置は作り方として返る（レシピに残すため）', () => {
    const built = pdfPagesToTable([FROZEN], { heads: [BUNRUI] })
    expect(built.heads).toEqual([BUNRUI])
  })

  it('人が直した列の境界と一緒でも効く（紙の列を決めたあとで右端に足す）', () => {
    const auto = pdfPagesToTable([FROZEN])
    const rows = pdfPagesToRows([FROZEN], { edges: auto.edges, heads: [BUNRUI] })
    expect(rows[1][rows[1].length - 1]).toBe('冷凍')
    expect(rows[1].length).toBe(4)
  })

  it('何も足さなければ、表はそれまでと同じ', () => {
    expect(pdfPagesToRows([FROZEN])).toEqual(pdfPagesToRows([FROZEN], { heads: [] }))
  })
})
