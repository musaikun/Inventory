/**
 * PDF → 行×列の表。ここが正しくないと、CSVと同じ画面に流しても
 * 「列が1本足りない」「右段が消えた」という形で人の側に出てくる。
 */
import { describe, it, expect } from 'vitest'
import { pdfPagesToRows, pdfPagesToCsv, pdfPagesToTable, suggestEdge } from './pdfGrid.js'

/** 読み方向(rotate=0)のトークンを作る。w は pdfjs の item.width 相当 */
const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6 })

// 1段の表（見出し + データ2行）
const PLAIN = {
  rotate: 0,
  tokens: [
    t('品名', 30, 750), t('単位', 150, 750), t('単価', 220, 750),
    t('豚バラ', 30, 720), t('kg', 150, 720), t('1200', 220, 720),
    t('キャベツ', 30, 700), t('玉', 150, 700), t('280', 220, 700),
  ],
}

describe('pdfPagesToRows — 1段の表', () => {
  it('見出しもデータも、行と列のまま表になる', () => {
    const rows = pdfPagesToRows([PLAIN])
    expect(rows).toEqual([
      ['品名', '単位', '単価'],
      ['豚バラ', 'kg', '1200'],
      ['キャベツ', '玉', '280'],
    ])
  })

  it('CSVにするとカンマ区切りの表になる', () => {
    expect(pdfPagesToCsv([PLAIN]).split('\r\n')[1]).toBe('豚バラ,kg,1200')
  })

  it('複数ページは縦に積む（列の位置はページ間で共通）', () => {
    const p2 = { rotate: 0, tokens: [t('人参', 30, 720), t('本', 150, 720), t('90', 220, 720)] }
    const rows = pdfPagesToRows([PLAIN, p2])
    expect(rows.length).toBe(4)
    expect(rows[3]).toEqual(['人参', '本', '90'])
  })
})

describe('pdfPagesToRows — 段組み', () => {
  // 同じ形の表が横に2枚（左 x=30.. / 右 x=330..）。行番号の列が見出しより左にある
  const TWO_UP = {
    rotate: 0,
    tokens: [
      t('No', 10, 750), t('品名', 30, 750), t('単価', 220, 750),
      t('No', 310, 750), t('品名', 330, 750), t('単価', 520, 750),
      t('1', 10, 720), t('豚バラ', 30, 720), t('1200', 220, 720),
      t('2', 310, 720), t('キャベツ', 330, 720), t('280', 520, 720),
    ],
  }

  it('右段を左段の下へ積む（段を分けないと単価が連結して右段が消える）', () => {
    const rows = pdfPagesToRows([TWO_UP], { sections: 2 })
    expect(rows).toEqual([
      ['No', '品名', '単価'],
      ['1', '豚バラ', '1200'],
      ['No', '品名', '単価'],
      ['2', 'キャベツ', '280'],
    ])
  })

  it('段の数を1と答えると右段は左段の行にぶら下がる（答えがそのまま結果に出る）', () => {
    const rows = pdfPagesToRows([TWO_UP], { sections: 1 })
    expect(rows.length).toBe(2)
    expect(rows[1].join(',')).toContain('キャベツ')
  })
})

describe('pdfPagesToRows — 紙のくせ', () => {
  it('折り返した品目名は1つのセルにまとまる（区間が重なる列は同じ列）', () => {
    const page = {
      rotate: 0,
      tokens: [
        t('豆乳', 30, 720, 18), t('２００ｍｌ', 51, 720, 45), t('本', 150, 720), t('100', 220, 720),
        t('牛乳 成分無調整 1L', 30, 700, 90), t('本', 150, 700), t('120', 220, 700),
      ],
    }
    const rows = pdfPagesToRows([page])
    expect(rows[0]).toEqual(['豆乳 ２００ｍｌ', '本', '100'])
    expect(rows[1][0]).toBe('牛乳 成分無調整 1L')
  })

  it('表の上の帳票見出しも行として残す（どの行からデータかは人が選ぶ）', () => {
    const page = {
      rotate: 0,
      tokens: [t('棚卸記入表', 30, 800, 60), ...PLAIN.tokens],
    }
    const rows = pdfPagesToRows([page])
    expect(rows[0][0]).toBe('棚卸記入表')
    expect(rows[1]).toEqual(['品名', '単位', '単価'])   // 表題で列が増えない
  })

  it('rotate=90 の帳票は読み方向へそろえてから表にする', () => {
    // 読み方向の (x,y) を rotate=90 の生座標へ戻す: x_raw = -y_read, y_raw = x_read
    const rot = (text, x, y, w) => ({ text, x: -y, y: x, w: w ?? text.length * 6 })
    const page = {
      rotate: 90,
      tokens: [
        rot('品名', 30, 750), rot('単位', 150, 750), rot('単価', 220, 750),
        rot('豚バラ', 30, 720), rot('kg', 150, 720), rot('1200', 220, 720),
      ],
    }
    expect(pdfPagesToRows([page])).toEqual([
      ['品名', '単位', '単価'],
      ['豚バラ', 'kg', '1200'],
    ])
  })

  it('左寄せの見出しと右寄せの数字がずれない（見出しの列に中身が入る）', () => {
    // 実物の帳票と同じ並び: 見出しは左寄せ、単価・数量は右寄せ
    const page = {
      rotate: 0,
      tokens: [
        t('品目コード', 30, 506, 40), t('品目名', 77, 506, 27), t('単位', 277, 506, 18),
        t('単価', 314, 506, 18), t('数量', 354, 506, 18),
        t('2001', 30, 486, 24), t('砂糖', 77, 486, 24), t('個', 277, 486, 9),
        t('480', 340, 486, 18), t('40', 384, 486, 12),
        t('2002', 30, 470, 24), t('紅茶葉', 77, 470, 30), t('箱', 277, 470, 9),
        t('90', 344, 470, 12), t('40', 384, 470, 12),
      ],
    }
    expect(pdfPagesToRows([page])).toEqual([
      ['品目コード', '品目名', '単位', '単価', '数量'],
      ['2001', '砂糖', '個', '480', '40'],
      ['2002', '紅茶葉', '箱', '90', '40'],
    ])
  })

  it('隣の見出しと文字が触れていても、1つのセルにしない', () => {
    // 列の詰まった帳票では見出しが隣とほとんど接する（`品目コード`の右端と`品目名`の左端が2px）。
    // 隙間の大きさでセルをまとめると、ここで `品目コード 品目名` が1マスになる
    const page = {
      rotate: 0,
      tokens: [
        t('品目コード', 30, 506, 45), t('品目名', 77, 506, 27), t('単位', 277, 506, 18),
        t('単価', 314, 506, 18), t('数量', 354, 506, 18),
        t('2001', 30, 486, 24), t('砂糖', 77, 486, 24), t('個', 277, 486, 9),
        t('480', 340, 486, 18), t('40', 384, 486, 12),
        t('2002', 30, 470, 24), t('紅茶葉', 77, 470, 30), t('箱', 277, 470, 9),
        t('90', 344, 470, 12), t('40', 384, 470, 12),
      ],
    }
    const rows = pdfPagesToRows([page])
    expect(rows[0]).toEqual(['品目コード', '品目名', '単位', '単価', '数量'])
    expect(rows[1]).toEqual(['2001', '砂糖', '個', '480', '40'])
  })

  it('値の欠けた行は位置から当てる（番号で入れて右へずらさない）', () => {
    const page = {
      rotate: 0,
      tokens: [
        ...PLAIN.tokens,
        t('人参', 30, 680), t('90', 220, 680),   // 単位が空の行
      ],
    }
    const rows = pdfPagesToRows([page])
    expect(rows[3]).toEqual(['人参', '', '90'])
  })

  it('回転した2段組みの帳票を、段ごとに縦へ積んで表にする', () => {
    // 実物の棚卸記入表（rotate=90・同じ表が横に2枚）。列の位置は実測値に合わせた。
    // 生座標では x が行・y が列なので、そろえないと右の表の商品名が左の表と同じ列に見える。
    const COL  = { no: 46,  code: 74,  name: 107, pack: 228, unit: 246, prev: 376 }
    const SEC2 = { no: 478, code: 506, name: 539, pack: 660, unit: 678, prev: 808 }
    const data = [
      ['12687', '豆乳 ２００ｍｌ', '本', '12', '30'], ['12690', '牛乳', '本', '6', '18'],
      ['12701', 'キャベツ', '玉', '1', '24'],        ['12702', '生クリーム ３５％', 'ｐ', '12', '9'],
      ['12703', '玉ねぎ', 'kg', '1', '40'],          ['12704', '鶏もも', 'kg', '1', '15'],
    ]
    const toks = []
    const put = (text, colX, rowY, w) => toks.push({ text, x: rowY, y: colX, w })
    for (const S of [COL, SEC2]) {
      put('商品ｺｰﾄﾞ', S.code, 129, 28); put('商品名', S.name, 129, 27); put('単位', S.unit, 129, 18)
      put('入数', S.pack, 129, 16); put('前月実績', S.prev, 129, 36)
      data.forEach((r, i) => {
        const y = 143 + i * 14
        put(String(i + 1), S.no, y, 6); put(r[0], S.code, y, 25)
        // 品目名は紙の上で折り返している（2つの文字として入っている行がある）
        const parts = r[1].split(' ')
        put(parts[0], S.name, y, parts[0].length * 9)
        if (parts[1]) put(parts[1], S.name + parts[0].length * 9 + 3, y, parts[1].length * 9)
        put(r[2], S.unit, y, 9); put(r[3], S.pack, y, 12); put(r[4], S.prev, y, 18)
      })
    }
    const rows = pdfPagesToRows([{ tokens: toks, rotate: 90 }], { sections: 2 })

    expect(rows.length).toBe(14)                    // (見出し1 + データ6) × 2段
    expect(rows[1]).toEqual(['1', '12687', '豆乳 ２００ｍｌ', '12', '本', '30'])
    expect(rows[8]).toEqual(['1', '12687', '豆乳 ２００ｍｌ', '12', '本', '30'])
    expect(rows[4]).toEqual(['4', '12702', '生クリーム ３５％', '12', 'ｐ', '9'])
  })

  it('トークンが無いページは何も足さない', () => {
    expect(pdfPagesToRows([{ rotate: 0, tokens: [] }])).toEqual([])
    expect(pdfPagesToRows([])).toEqual([])
    expect(pdfPagesToRows(null)).toEqual([])
  })

  it('カンマを含む品目名でも列が割れない', () => {
    const page = { rotate: 0, tokens: [t('レモン,国産', 30, 720, 60), t('個', 150, 720), t('80', 220, 720)] }
    expect(pdfPagesToCsv([page])).toBe('"レモン,国産",個,80')
  })
})

// 専用の解析を持たない紙は、一度で正しく組み上がらない。直すつまみは
// 「行の高さ」と「列の境界」の2つで、どちらも数値なのでレシピに残せる。
describe('組み上がった表を人が直す', () => {
  // 行間20px・文字の高さ10pxの紙。品目名だけ少し上にずれて刷られている
  const SHIFTED = {
    rotate: 0,
    tokens: [
      { text: '豚バラ', x: 30, y: 726, w: 27, h: 10 }, { text: 'kg', x: 150, y: 720, w: 12, h: 10 },
      { text: '1200',  x: 220, y: 720, w: 24, h: 10 },
      { text: 'キャベツ', x: 30, y: 706, w: 36, h: 10 }, { text: '玉', x: 150, y: 700, w: 9, h: 10 },
      { text: '280',   x: 220, y: 700, w: 18, h: 10 },
    ],
  }

  it('行が2つに割れていたら、行の高さを上げるとまとまる', () => {
    // 既定（文字の高さ×0.5＝5px）では 6px のずれを別の行として読む
    expect(pdfPagesToRows([SHIFTED]).length).toBe(4)
    // 上げると同じ行になる
    const merged = pdfPagesToRows([SHIFTED], { rowFactor: 1.0 })
    expect(merged.length).toBe(2)
    expect(merged[0]).toEqual(['豚バラ', 'kg', '1200'])
  })

  it('自動で決めた列は境界の並びとして返る（そこから人が直せる）', () => {
    const t = pdfPagesToTable([PLAIN])
    expect(t.rows.length).toBe(3)
    expect(t.edges.length).toBe(2)                       // 3列 = 境界2本
    expect(t.edges[0]).toBeGreaterThan(30)
    expect(t.edges[0]).toBeLessThan(150)
  })

  it('境界を渡すと、その線のとおりに列が分かれる', () => {
    const t = pdfPagesToTable([PLAIN], { edges: [200] })  // 1本だけ＝2列
    expect(t.rows[1]).toEqual(['豚バラ kg', '1200'])
  })

  it('くっついた列の切りどころは、紙のいちばん広い空白から出す', () => {
    const at = suggestEdge([PLAIN], { edges: [200] }, 0)  // 品名+単位が同じ列にいる
    expect(at).toBeGreaterThan(48)                        // 品名の右端より右
    expect(at).toBeLessThan(150)                          // 単位の左端より左
    expect(pdfPagesToTable([PLAIN], { edges: [at, 200] }).rows[1]).toEqual(['豚バラ', 'kg', '1200'])
  })

  it('切りどころが無い列では null を返す（画面はボタンを出さない）', () => {
    expect(suggestEdge([PLAIN], { edges: [45] }, 0)).toBe(null)
  })
})
