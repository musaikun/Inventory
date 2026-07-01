import { describe, it, expect } from 'vitest'
import { normalize, scoreMatch, isSupplyItem, findCandidates, findSimilarNames } from './itemMatcher.js'

describe('normalize', () => {
  it('半角カタカナを全角経由でひらがなに変換する', () => {
    expect(normalize('ﾀﾏﾈｷﾞ')).toBe('たまねぎ')
  })

  it('カタカナをひらがなに変換する', () => {
    expect(normalize('タマネギ')).toBe('たまねぎ')
  })

  it('全角英数を半角小文字に変換する', () => {
    expect(normalize('ＡＢＣ１２３')).toBe('abc123')
  })

  it('空白を除去する', () => {
    expect(normalize('玉 ね ぎ')).toBe('玉ねぎ')
  })
})

describe('scoreMatch', () => {
  it('完全一致が最高スコア', () => {
    expect(scoreMatch('たまねぎ', 'たまねぎ')).toBe(1000)
  })

  it('前方一致 > 部分一致 の優先順位', () => {
    const prefix   = scoreMatch('たまねぎ', 'たま')
    const includes = scoreMatch('新たまねぎ', 'たま')
    expect(prefix).toBeGreaterThan(includes)
    expect(includes).toBeGreaterThan(0)
  })

  it('入力が品目名を包含する場合もマッチする', () => {
    expect(scoreMatch('たま', 'たまねぎください')).toBeGreaterThan(0)
  })

  it('無関係な文字列は 0', () => {
    expect(scoreMatch('たまねぎ', 'にんじん')).toBe(0)
  })

  it('長い一致ほどスコアが高い（同じ一致種別内）', () => {
    expect(scoreMatch('たまねぎ', 'たまね')).toBeGreaterThan(scoreMatch('たまねぎ', 'たま'))
  })
})

describe('isSupplyItem', () => {
  const categories = { '割り箸': '資材', 'ペーパー': '備品消耗品', '謎の品': 'その他', '玉ねぎ': '野菜' }

  it('資材・備品・その他カテゴリは true', () => {
    expect(isSupplyItem('割り箸', categories)).toBe(true)
    expect(isSupplyItem('ペーパー', categories)).toBe(true)
    expect(isSupplyItem('謎の品', categories)).toBe(true)
  })

  it('食材カテゴリは false', () => {
    expect(isSupplyItem('玉ねぎ', categories)).toBe(false)
  })

  it('カテゴリ未設定・categories 無しは false', () => {
    expect(isSupplyItem('未分類', categories)).toBe(false)
    expect(isSupplyItem('玉ねぎ', undefined)).toBe(false)
  })
})

describe('findCandidates', () => {
  const ctx = {
    dictionary: { 'たまねぎ': '玉ねぎ', 'オニオン': '玉ねぎ', 'にんじん': '人参' },
    order:      ['玉ねぎ', '人参', 'コーヒー豆 ブラジル', '割り箸'],
    categories: { '割り箸': '資材' },
    masterDict: { 'こめ': ['白米', '玄米'], 'はし': ['割り箸'] },
  }

  it('空入力は空配列', () => {
    expect(findCandidates('', ctx)).toEqual([])
    expect(findCandidates(null, ctx)).toEqual([])
  })

  it('辞書エイリアスで正式品目を見つける', () => {
    expect(findCandidates('オニオン', ctx)).toEqual(['玉ねぎ'])
  })

  it('カタカナ・ひらがな・半角カナを同一視する', () => {
    expect(findCandidates('タマネギ', ctx)).toContain('玉ねぎ')
    expect(findCandidates('ﾀﾏﾈｷﾞ', ctx)).toContain('玉ねぎ')
  })

  it('正式品目名の前方一致でもマッチする（コーヒー豆 → コーヒー豆 ブラジル）', () => {
    expect(findCandidates('コーヒー豆', ctx)).toContain('コーヒー豆 ブラジル')
  })

  it('マスター辞書のキーワードは品目リストにある品目だけ返す', () => {
    // 白米・玄米は order に無いので除外、割り箸はある
    expect(findCandidates('こめ', ctx)).toEqual([])
    expect(findCandidates('はし', ctx)).toContain('割り箸')
  })

  it('完全一致がリスト先頭に来る', () => {
    const ctx2 = {
      ...ctx,
      dictionary: { 'たま': '玉子', 'たまねぎ': '玉ねぎ' },
      order: ['玉子', '玉ねぎ'],
    }
    expect(findCandidates('たまねぎ', ctx2)[0]).toBe('玉ねぎ')
  })

  it('scope=food は資材を除外する', () => {
    const all = findCandidates('はし', { ...ctx, scope: 'all' })
    expect(all).toContain('割り箸')
    const food = findCandidates('はし', { ...ctx, scope: 'food' })
    expect(food).not.toContain('割り箸')
  })

  it('scope=supply は資材のみ返す', () => {
    const supply = findCandidates('たまねぎ', { ...ctx, scope: 'supply' })
    expect(supply).not.toContain('玉ねぎ')
  })

  it('辞書・マスター辞書が無くても品目名直接マッチで動く', () => {
    expect(findCandidates('タマネギ', { dictionary: {}, order: ['たまねぎ'], categories: {}, masterDict: {} }))
      .toContain('たまねぎ')
  })
})

describe('findSimilarNames（新規追加時の重複警告）', () => {
  const order = ['牛乳', '牛乳（低脂肪）', 'コカコーラ', 'ビール']

  it('部分文字列を含む既存品目を返す', () => {
    expect(findSimilarNames('牛乳', order)).toContain('牛乳（低脂肪）')
  })

  it('入力が既存品目を内包する場合も検出（逆方向の部分一致）', () => {
    // 「コカコーラゼロ」は既存「コカコーラ」を内包する
    expect(findSimilarNames('コカコーラゼロ', order)).toContain('コカコーラ')
  })

  it('完全一致は除外する（それは登録済みエラーの担当）', () => {
    expect(findSimilarNames('ビール', order)).not.toContain('ビール')
  })

  it('似ていない品目は返さない', () => {
    expect(findSimilarNames('トマト', order)).toEqual([])
  })

  it('空文字・空白のみは空配列', () => {
    expect(findSimilarNames('', order)).toEqual([])
    expect(findSimilarNames('　 ', order)).toEqual([])
  })

  it('大文字小文字を無視する', () => {
    expect(findSimilarNames('coca', ['CocaCola'])).toContain('CocaCola')
  })
})
