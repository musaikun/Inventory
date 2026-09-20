/**
 * 紙の割り方（横の段 × 縦の積み）。
 *
 * 人に訊くのは**枚数だけ**で、縦か横かは紙が決める。ここが外れると、
 * 「右半分の品目がまるごと消える」「下の表が上の表の行にぶら下がる」という形で
 * 人の側に出てくる。しかも読んだ後では**無いことに気づけない**（だから枚数だけは訊く）。
 */
import { describe, it, expect } from 'vitest'
import { pdfPagesToRows, pdfPagesToTable, planLayout, detectLayout, GRID_MAX } from './pdfGrid.js'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6 })

// 縦に2枚積まれた紙。表と表のあいだ（710→640）が行間（20）よりずっと広い
const STACKED = {
  rotate: 0,
  tokens: [
    t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
    t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
    t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
    t('品名', 30, 640), t('単位', 150, 640), t('単価', 230, 640),
    t('人参', 30, 620), t('本', 150, 620), t('90', 230, 620),
    t('白菜', 30, 600), t('玉', 150, 600), t('200', 230, 600),
  ],
}

// 横に2枚並んだ紙
const SIDE = {
  rotate: 0,
  tokens: [
    t('品名', 30, 750), t('単価', 230, 750),
    t('品名', 330, 750), t('単価', 530, 750),
    t('豚バラ', 30, 730), t('1200', 230, 730),
    t('人参', 330, 730), t('90', 530, 730),
  ],
}

// 2×2。左上→左下→右上→右下 の順に読むのが正
const GRID2X2 = {
  rotate: 0,
  tokens: [
    t('品名', 30, 750), t('単価', 230, 750),
    t('品名', 330, 750), t('単価', 530, 750),
    t('A', 30, 730), t('1', 230, 730),
    t('C', 330, 730), t('3', 530, 730),
    t('品名', 30, 640), t('単価', 230, 640),
    t('品名', 330, 640), t('単価', 530, 640),
    t('B', 30, 620), t('2', 230, 620),
    t('D', 330, 620), t('4', 530, 620),
  ],
}

describe('planLayout — 枚数だけから割り方を決める', () => {
  it('縦に積まれた紙は縦2枚と読む（列のあいだの空白に釣られない）', () => {
    expect(planLayout([STACKED], 2).best).toEqual({ cols: 1, rows: 2 })
  })

  it('横に並んだ紙は横2枚と読む', () => {
    expect(planLayout([SIDE], 2).best).toEqual({ cols: 2, rows: 1 })
  })

  it('4枚は2×2と読む（4×1・1×4より見出しの並びに合う）', () => {
    expect(planLayout([GRID2X2], 4).best).toEqual({ cols: 2, rows: 2 })
  })

  it('候補は約数の組み合わせを全部返す（画面で切り替えられるように）', () => {
    const { candidates } = planLayout([GRID2X2], 4)
    expect(candidates.map(c => `${c.cols}x${c.rows}`).sort())
      .toEqual(['1x4', '2x2', '4x1'])
  })

  it('1枚は候補も1つ', () => {
    const { best, candidates } = planLayout([SIDE], 1)
    expect(best).toEqual({ cols: 1, rows: 1 })
    expect(candidates.length).toBe(1)
  })

  it('枚数が自動判定と違っても、見えている段の数は活かす（2段の紙で4枚と答えたら2×2）', () => {
    expect(planLayout([SIDE], 4).best).toEqual({ cols: 2, rows: 2 })
  })

  it('上限を超える枚数は上限に丸める（存在しない割り方を作らない）', () => {
    const { best } = planLayout([SIDE], 99)
    expect(best.cols * best.rows).toBeLessThanOrEqual(GRID_MAX)
  })

  it('文字が無い紙でも落ちない', () => {
    expect(planLayout([], 3).best.cols * planLayout([], 3).best.rows).toBe(3)
  })
})

describe('detectLayout — 9枚を目で数えさせない', () => {
  it('横に並んだ見出しの数が横の枚数', () => {
    expect(detectLayout([SIDE])).toEqual({ cols: 2, rows: 1, count: 2 })
  })

  it('縦に並んだ見出しの数が縦の枚数', () => {
    expect(detectLayout([STACKED])).toEqual({ cols: 1, rows: 2, count: 2 })
  })

  it('2×2は4枚と見える', () => {
    expect(detectLayout([GRID2X2])).toEqual({ cols: 2, rows: 2, count: 4 })
  })

  it('品目名の見出しが無い紙は分からないと答える（当てずっぽうを出さない）', () => {
    const noHead = { rotate: 0, tokens: [t('豚バラ', 30, 730), t('1200', 230, 730)] }
    expect(detectLayout([noHead])).toBe(null)
  })

  it('上限を超えて見えた紙は分からないと答える', () => {
    const many = { rotate: 0, tokens: [] }
    for (let i = 0; i < 12; i++) many.tokens.push(t('品名', 30 + i * 60, 750))
    expect(detectLayout([many])).toBe(null)
  })
})

describe('pdfPagesToRows — 格子で割る', () => {
  it('縦に積まれた表は上から下へ続く', () => {
    const rows = pdfPagesToRows([STACKED], { layout: { cols: 1, rows: 2 } })
    expect(rows.map(r => r[0])).toEqual(['品名', '豚バラ', 'キャベツ', '品名', '人参', '白菜'])
  })

  it('2×2は左の段を下まで使ってから次の段へ（品目の並び順がここで決まる）', () => {
    const rows = pdfPagesToRows([GRID2X2], { layout: { cols: 2, rows: 2 } })
    expect(rows.filter(r => r[0] !== '品名').map(r => r[0])).toEqual(['A', 'B', 'C', 'D'])
  })

  it('下の表が横にずれていても列が揃う（帯ごとに原点を持つ）', () => {
    // 下の表だけ x を +120 ずらす。1列ぶんより大きいずれ
    const shifted = {
      rotate: 0,
      tokens: STACKED.tokens.map(tk => (tk.y <= 640 ? { ...tk, x: tk.x + 120 } : tk)),
    }
    const rows = pdfPagesToRows([shifted], { layout: { cols: 1, rows: 2 } })
    expect(rows.length).toBe(6)
    expect(rows.every(r => r.length === 3)).toBe(true)
    expect(rows[4]).toEqual(['人参', '本', '90'])
  })

  it('古いレシピ（sections だけ）は横の段として効く（保存済みの読み方を壊さない）', () => {
    const rows = pdfPagesToRows([SIDE], { sections: 2 })
    expect(rows.map(r => r[0])).toEqual(['品名', '豚バラ', '品名', '人参'])
  })

  it('組み上がった表は、使った割り方を一緒に返す（レシピに残すため）', () => {
    expect(pdfPagesToTable([GRID2X2], { layout: { cols: 2, rows: 2 } }).layout)
      .toEqual({ cols: 2, rows: 2 })
  })
})
