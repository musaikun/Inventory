/**
 * IMPORT-001 — Codex 2026-08-09 レビューで確認された品目取込のデータ欠陥に対する回帰テスト。
 *
 * ここに並ぶケースは、修正前の実装では「黙って別の値になる」「黙って捨てられる」ものだけを選んでいる。
 * 例外を投げるだけの入力（データ行なし等）は既存の useConfig.importMerge.test.js 側にある。
 */
import { describe, it, expect } from 'vitest'
import {
  parseItemCSV,
  parseMappedCSV,
  buildImportPlan,
  summaryCounts,
  looksLikeHeaderRow,
  IMPORT_MODE_MERGE,
  IMPORT_MODE_REPLACE,
  IMPORT_ERROR_NO_HEADER,
  IMPORT_ERROR_NO_VALID_ROWS,
  ALIAS_KEEP_EXISTING,
  ALIAS_TAKEOVER,
  ITEM_NAME_MAX,
} from './itemImport.js'

const HEAD = '品目名,単位,単価,カテゴリ,エイリアス'
const emptyConfig = (over = {}) => ({
  order: [], units: {}, prices: {}, categories: {}, codes: {}, categoryCodes: {},
  prevMonths: {}, lotSizes: {}, reorderPoints: {}, dictionary: {},
  tagsA: {}, tagsB: {}, tagsArchiveA: {}, tagsArchiveB: {},
  axisNames: ['', ''], manualItems: [], ...over,
})
const plan = (csv, cfg = emptyConfig(), opts = {}) => buildImportPlan(parseItemCSV(csv), cfg, opts)

describe('数値セル — 黙って別の値にしない', () => {
  it('引用符つき桁区切り "1,200" を 1 ではなく 1200 として取り込む', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,"1,200",野菜,`)
    expect(p.rows[0].price).toBe(1200)
    expect(p.errors).toEqual([])
  })

  it('不正な単価を「既存値を維持」にすり替えず、行番号・列・理由つきのエラーにする', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,あ,野菜,\nレタス,玉,120,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['レタス'])
    expect(p.errors).toHaveLength(1)
    expect(p.errors[0]).toMatchObject({ line: 2, columnLabel: '単価', name: 'トマト' })
    expect(p.errors[0].reason).toContain('数値として読めません')
  })

  it('不正な単価の行は既存の単価も書き換えない', () => {
    const cfg = emptyConfig({ order: ['トマト', 'レタス'], prices: { トマト: 500 }, units: { トマト: '箱' } })
    const p = plan(`${HEAD}\nトマト,ケース,あ,野菜,\nレタス,玉,120,野菜,`, cfg)
    expect(p.prices['トマト']).toBe(500)
    expect(p.units['トマト']).toBe('箱')       // 同じ行の他の列も適用しない
    expect(p.summary.errors).toHaveLength(1)
  })

  it('0以下の単価を拒否して理由を残す', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,0,野菜,\nレタス,玉,-5,野菜,\nきゅうり,本,90,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['きゅうり'])
    expect(p.errors.map(e => e.line)).toEqual([2, 3])
  })

  it('負の発注点を拒否する', () => {
    const head = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点'
    const p = parseItemCSV(`${head}\nトマト,箱,120,野菜,,,,,,,,-3\nレタス,玉,90,野菜,,,,,,,,4`)
    expect(p.rows.map(r => r.name)).toEqual(['レタス'])
    expect(p.errors[0]).toMatchObject({ columnLabel: '発注点', line: 2 })
  })

  it('1行も取り込めないときも、除外理由を例外へ載せてプレビューが出せるようにする', () => {
    let thrown
    try { parseItemCSV(`${HEAD}\nトマト,箱,あ,野菜,`) } catch (e) { thrown = e }
    expect(thrown.code).toBe(IMPORT_ERROR_NO_VALID_ROWS)
    expect(thrown.errors).toHaveLength(1)
    expect(thrown.errors[0]).toMatchObject({ line: 2, columnLabel: '単価' })
  })
})

describe('CSV の字句解析', () => {
  it('エスケープされた引用符を値の中の " として保つ', () => {
    const p = parseItemCSV(`${HEAD}\n"5"" 皿",枚,100,食器,`)
    expect(p.rows[0].name).toBe('5" 皿')
  })

  it('閉じていない引用符を黙って受理しない', () => {
    expect(() => parseItemCSV(`${HEAD}\n"トマト,箱,120,野菜,`))
      .toThrow(/引用符/)
  })

  it('列数がヘッダと一致しない行を行番号つきで除外する', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,120,野菜,\nレタス,玉,120`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト'])
    expect(p.errors[0]).toMatchObject({ line: 3, columnLabel: '列数' })
    expect(p.errors[0].reason).toContain('列数')
  })

  it('CRLF・BOM・日本語・空行を仕様どおり処理する', () => {
    const p = parseItemCSV('﻿品目名,単位\r\nトマト,個\r\n\r\nレタス,玉\r\n')
    expect(p.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(p.rows.map(r => r.line)).toEqual([2, 4])   // 行番号はファイルのまま
  })

  it('ファイル内の重複は先頭行を採用し、行番号つきで除外理由を残す', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,120,野菜,\nトマト,玉,150,野菜,`)
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0].unit).toBe('箱')
    expect(p.duplicates).toBe(1)
    expect(p.skipped[0]).toMatchObject({ line: 3, name: 'トマト' })
  })

  it('空欄セルは既存値を消さない（未指定として扱う）', () => {
    const cfg = emptyConfig({ order: ['トマト'], units: { トマト: '箱' }, prices: { トマト: 500 } })
    const p = plan(`${HEAD}\nトマト,,,,`, cfg)
    expect(p.units['トマト']).toBe('箱')
    expect(p.prices['トマト']).toBe(500)
  })
})

describe('ヘッダ無しファイル', () => {
  it('先頭行がヘッダでないファイルは、先頭品目を捨てずにエラーにする', () => {
    let thrown
    try { parseItemCSV('トマト,箱\nレタス,玉') } catch (e) { thrown = e }
    expect(thrown).toBeDefined()
    expect(thrown.code).toBe(IMPORT_ERROR_NO_HEADER)
  })

  it('列指定 + hasHeader:false なら1行目も品目として取り込む', () => {
    const p = parseMappedCSV('トマト,箱\nレタス,玉', { name: 0, unit: 1 }, { hasHeader: false })
    expect(p.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(p.rows[0].line).toBe(1)
  })

  it('looksLikeHeaderRow は代表的な見出し表記を認める', () => {
    for (const h of ['品目名', '商品名', '品名', '名称', 'name', 'Item']) {
      expect(looksLikeHeaderRow([h]), h).toBe(true)
    }
    expect(looksLikeHeaderRow(['トマト'])).toBe(false)
  })
})

describe('品目名の切り詰め', () => {
  it('上限を超える品目名は切り詰め、切り詰めた事実をプレビューへ残す', () => {
    const long = 'あ'.repeat(ITEM_NAME_MAX + 20)
    const p = plan(`${HEAD}\n${long},箱,120,野菜,`)
    expect(p.order[0]).toHaveLength(ITEM_NAME_MAX)
    expect(p.summary.truncatedNames).toHaveLength(1)
    expect(p.summary.truncatedNames[0]).toMatchObject({ line: 2, after: 'あ'.repeat(ITEM_NAME_MAX) })
  })
})

describe('エイリアス衝突', () => {
  const withAlias = () => emptyConfig({
    order: ['トマト', 'レタス'],
    dictionary: { あかいやつ: 'トマト' },
  })

  it('既存品目のエイリアスを、別の品目が黙って奪わない', () => {
    const p = plan(`${HEAD}\nレタス,玉,,,"あかいやつ"`, withAlias())
    expect(p.dictionary['あかいやつ']).toBe('トマト')          // 既存の持ち主のまま
    expect(p.summary.aliasConflicts).toHaveLength(1)
    expect(p.summary.aliasConflicts[0]).toMatchObject({
      alias: 'あかいやつ', from: 'トマト', to: 'レタス', kind: 'existing', line: 2,
    })
  })

  it('明示的に takeover を選んだときだけ付け替える', () => {
    const p = plan(`${HEAD}\nレタス,玉,,,"あかいやつ"`, withAlias(), { aliasPolicy: ALIAS_TAKEOVER })
    expect(p.dictionary['あかいやつ']).toBe('レタス')
    expect(p.summary.aliasConflicts).toHaveLength(1)          // 解決しても衝突は記録に残す
  })

  it('既定は「既存を守る」', () => {
    const p = plan(`${HEAD}\nレタス,玉,,,"あかいやつ"`, withAlias(), { aliasPolicy: ALIAS_KEEP_EXISTING })
    expect(p.dictionary['あかいやつ']).toBe('トマト')
  })

  it('既存品目名と同じエイリアスは、その品目を隠すので衝突として扱う', () => {
    const p = plan(`${HEAD}\nレタス,玉,,,"トマト"`, withAlias())
    expect(p.dictionary['トマト']).toBeUndefined()
    expect(p.summary.aliasConflicts[0]).toMatchObject({ alias: 'トマト', kind: 'item' })
  })

  it('ファイル内で同じエイリアスを2品目が取り合う場合も衝突として出す', () => {
    const p = plan(`${HEAD}\nきゅうり,本,,,"みどり"\nピーマン,個,,,"みどり"`, emptyConfig())
    expect(p.dictionary['みどり']).toBe('きゅうり')            // 先に出た行を採用
    expect(p.summary.aliasConflicts[0]).toMatchObject({ kind: 'file', from: 'きゅうり', to: 'ピーマン' })
  })

  it('同じ品目が自分のエイリアスを再指定するのは衝突にしない', () => {
    const p = plan(`${HEAD}\nトマト,箱,,,"あかいやつ"`, withAlias())
    expect(p.summary.aliasConflicts).toEqual([])
    expect(p.dictionary['あかいやつ']).toBe('トマト')
  })

  it('全入れ替えで消える品目のエイリアスは衝突にせず、辞書からも落とす', () => {
    const cfg = withAlias()
    const p = plan(`${HEAD}\nレタス,玉,,,"あかいやつ"`, cfg, { mode: IMPORT_MODE_REPLACE })
    expect(p.summary.removed).toEqual(['トマト'])
    expect(p.dictionary['あかいやつ']).toBe('レタス')
    expect(p.summary.aliasConflicts).toEqual([])
  })
})

describe('プレビューに出す変更', () => {
  it('分類コードの変更をカテゴリ単位で出す', () => {
    const csv = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数\nトマト,箱,120,野菜,,,7,,'
    const p = plan(csv, emptyConfig({ categoryCodes: { 野菜: 3 } }))
    expect(p.summary.categoryCodeChanges).toContainEqual({ category: '野菜', before: 3, after: 7 })
  })

  it('ファイル列名から採用する軸名を出す', () => {
    const csv = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,保管場所,仕入先\nトマト,箱,120,野菜,,,,,,冷蔵,青果A'
    const p = plan(csv, emptyConfig())
    expect(p.summary.axisNameChanges).toEqual([
      { index: 0, before: '', after: '保管場所', source: '保管場所' },
      { index: 1, before: '', after: '仕入先',   source: '仕入先' },
    ])
  })

  it('Free 上限を超えた分を truncated として出し、既存品目は消さない', () => {
    const cfg = emptyConfig({ order: ['既存'] })
    const csv = `${HEAD}\n` + ['A', 'B', 'C'].map(n => `${n},個,,,`).join('\n')
    const p = plan(csv, cfg, { itemLimit: 3, mode: IMPORT_MODE_MERGE })
    expect(p.order).toEqual(['既存', 'A', 'B'])
    expect(p.summary.truncated).toEqual(['C'])
  })

  it('summaryCounts が error・alias衝突・切り詰めも数える', () => {
    const p = plan(`${HEAD}\nトマト,箱,あ,野菜,\nレタス,玉,120,野菜,`)
    const c = summaryCounts(p.summary)
    expect(c).toMatchObject({ added: 1, errors: 1, aliasConflicts: 0, truncatedNames: 0 })
  })
})

describe('発注点の保持・消去', () => {
  const REORDER_HEAD = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点'

  it('発注点列が無いファイルは既存の発注点を保持する（merge / replace とも）', () => {
    const cfg = emptyConfig({ order: ['トマト'], reorderPoints: { トマト: 5 } })
    expect(plan(`${HEAD}\nトマト,箱,,,`, cfg).reorderPoints['トマト']).toBe(5)
    expect(plan(`${HEAD}\nトマト,箱,,,`, cfg, { mode: IMPORT_MODE_REPLACE }).reorderPoints['トマト']).toBe(5)
    expect(plan(`${HEAD}\nトマト,箱,,,`, cfg).summary.reorderPointsFromFile).toBe(false)
  })

  it('発注点列があり空欄なら解除し、解除対象をプレビューへ出す', () => {
    const cfg = emptyConfig({ order: ['トマト'], reorderPoints: { トマト: 5 } })
    const p = plan(`${REORDER_HEAD}\nトマト,箱,,,,,,,,,,`, cfg)
    expect(p.reorderPoints['トマト']).toBeUndefined()
    expect(p.summary.reorderPointsFromFile).toBe(true)
    expect(p.summary.reorderPointsCleared).toEqual(['トマト'])
  })

  it('発注点列に値があれば更新する', () => {
    const cfg = emptyConfig({ order: ['トマト'], reorderPoints: { トマト: 5 } })
    const p = plan(`${REORDER_HEAD}\nトマト,箱,,,,,,,,,,12`, cfg)
    expect(p.reorderPoints['トマト']).toBe(12)
    expect(p.summary.reorderPointsCleared).toEqual([])
  })
})

describe('merge / replace の非破壊性', () => {
  it('merge はファイルに無い既存品目を消さない', () => {
    const cfg = emptyConfig({ order: ['既存A', '既存B'], units: { 既存A: '箱' } })
    const p = plan(`${HEAD}\n新規,個,,,`, cfg, { mode: IMPORT_MODE_MERGE })
    expect(p.order).toEqual(['既存A', '既存B', '新規'])
    expect(p.summary.removed).toEqual([])
  })

  it('replace は削除対象を事前に列挙する', () => {
    const cfg = emptyConfig({ order: ['既存A', '既存B'] })
    const p = plan(`${HEAD}\n新規,個,,,`, cfg, { mode: IMPORT_MODE_REPLACE })
    expect(p.summary.removed).toEqual(['既存A', '既存B'])
    expect(p.order).toEqual(['新規'])
  })
})
