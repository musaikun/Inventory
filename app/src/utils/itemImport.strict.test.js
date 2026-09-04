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

  // 2026-09-02 の User判断で契約が1段変わった。
  //   旧: 読めない値 → その行を丸ごと捨てる
  //   新: 読めない値 → **その欄だけ**触らず、行は取り込み、読めなかったことを必ず出す
  // 守りたかったものは同じ（読めない値を「既存値の維持」へ黙ってすり替えない）。
  // 守り方が「捨てる」から「言う」に変わっただけで、黙るのは今も禁じ手。
  it('不正な単価でも行は取り込み、単価の欄だけ触らずに理由を残す', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,あ,野菜,\nレタス,玉,120,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(p.rows[0].price).toBeUndefined()       // 読めなかった欄は値を持たない
    expect(p.rows[0].unit).toBe('箱')             // 同じ行の読めた列は入る
    expect(p.unreadable).toHaveLength(1)
    expect(p.unreadable[0]).toMatchObject({ line: 2, columnLabel: '単価', name: 'トマト' })
    expect(p.unreadable[0].reason).toContain('数値として読めません')
    expect(p.errors).toEqual([])                  // 行としてはエラーではない
  })

  it('不正な単価は既存の単価を書き換えない（読めた列だけ更新する）', () => {
    const cfg = emptyConfig({ order: ['トマト', 'レタス'], prices: { トマト: 500 }, units: { トマト: '箱' } })
    const p = plan(`${HEAD}\nトマト,ケース,あ,野菜,\nレタス,玉,120,野菜,`, cfg)
    expect(p.prices['トマト']).toBe(500)          // ここが崩れると IMPORT-001 の逆戻り
    expect(p.units['トマト']).toBe('ケース')      // 読めた列は更新する（行を捨てないので）
    expect(p.summary.unreadable).toHaveLength(1)
  })

  it('0以下の単価も欄だけ落として理由を残す', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,0,野菜,\nレタス,玉,-5,野菜,\nきゅうり,本,90,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト', 'レタス', 'きゅうり'])
    expect(p.rows.map(r => r.price)).toEqual([undefined, undefined, 90])
    expect(p.unreadable.map(e => e.line)).toEqual([2, 3])
  })

  it('読めない発注点を「解除」に化けさせない（既存の発注点を守る）', () => {
    const head = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点'
    const cfg = emptyConfig({ order: ['トマト', 'レタス'], reorderPoints: { トマト: 7 } })
    const parsed = parseItemCSV(`${head}\nトマト,箱,120,野菜,,,,,,,,-3\nレタス,玉,90,野菜,,,,,,,,4`)
    expect(parsed.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(parsed.unreadable[0]).toMatchObject({ columnLabel: '発注点', line: 2 })
    // 発注点列を持つファイルは発注点を置き直す。読めなかった行だけは既存を残す。
    const p = buildImportPlan(parsed, cfg, {})
    expect(p.reorderPoints['トマト']).toBe(7)
    expect(p.reorderPoints['レタス']).toBe(4)
    expect(p.summary.reorderPointsCleared).toEqual([])
  })

  it('1行も取り込めないときは、除外理由を例外へ載せてプレビューが出せるようにする', () => {
    let thrown
    try { parseItemCSV(`${HEAD}\n,箱,120,野菜,`) } catch (e) { thrown = e }
    expect(thrown.code).toBe(IMPORT_ERROR_NO_VALID_ROWS)
    expect(thrown.skipped).toHaveLength(1)
    expect(thrown.skipped[0]).toMatchObject({ line: 2 })
  })

  it('単価が読めないだけのファイルは、もう「1件も取り込めない」にならない', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,あ,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト'])
    expect(p.unreadable).toHaveLength(1)
  })
})

describe('同じ名前・違う商品コード', () => {
  // 実物（PRONTO 棚卸記入表）は品目名を印字幅で切り詰めるため、サイズ違いの別商品が
  // 同じ名前になる。名前だけの重複判定で 22件が「ファイル内の重複」として黙って落ちていた。
  // コードが全員違う＝確実に別商品で、棚卸でサイズ違いを1件に潰すと在庫数が合わなくなる。
  const CODE_HEAD = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数'
  const SIZES = `${CODE_HEAD}
サラダ用カップ,個,20,資材,,12687,,,
サラダ用カップ,個,22,資材,,12688,,,
サラダ用カップ,個,24,資材,,12689,,,
キャベツ,個,180,野菜,,900,,,
キャベツ,個,180,野菜,,900,,,`

  it('「重複」に混ぜず、専用の理由で必ず見せる', () => {
    const p = parseItemCSV(SIZES)
    expect(p.rows.map(r => r.name)).toEqual(['サラダ用カップ', 'キャベツ'])
    expect(p.codeCollisions.map(c => [c.line, c.code])).toEqual([[3, '12688'], [4, '12689']])
    expect(p.codeCollisions[0].reason).toContain('別の商品')
    // 同じ名前・同じコードは、今までどおりただの重複
    expect(p.skipped.map(sk => sk.line)).toEqual([6])
    expect(p.duplicates).toBe(1)
  })

  it('splitByCode でコードを名前に付けて全部登録できる', () => {
    const p = parseItemCSV(SIZES, { splitByCode: true })
    expect(p.rows.map(r => r.name)).toEqual([
      'サラダ用カップ（12687）', 'サラダ用カップ（12688）', 'サラダ用カップ（12689）', 'キャベツ',
    ])
    expect(p.codeCollisions).toEqual([])
    expect(p.rows[0].code).toBe('12687')      // コードそのものは列の値のまま
    // 同名・同コードの重複はコードを付けても1件のまま（別商品ではない）
    expect(p.duplicates).toBe(1)
  })

  it('コード列が無いファイルでは今までどおりの重複判定', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,120,野菜,\nトマト,玉,130,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト'])
    expect(p.codeCollisions).toEqual([])
    expect(p.duplicates).toBe(1)
  })

  it('summaryCounts に同名・別コードの件数が出る', () => {
    expect(summaryCounts(plan(SIZES).summary)).toMatchObject({ added: 2, codeCollisions: 2 })
  })
})

describe('品目ではない行（小計・区分見出し）', () => {
  // 業者の請求明細をそのまま入れると、「小計」が単価つきの品目として登録され、
  // 品目リスト・棚卸カード・発注点に残って手で消すことになる。
  // pdfTableParser は元から外していたのに、CSV経路にだけ同じ仕組みが無かった。
  const DIRTY = `${HEAD}\n【野菜】,,,,\nキャベツ,個,180,野菜,\n玉ねぎ,kg,240,野菜,\n小計,,420,,\n【精肉】,,,,\n豚バラ,kg,980,精肉,\n合計,,1400,,`

  it('既定では品目として取り込まず、理由つきで返す', () => {
    const p = parseItemCSV(DIRTY)
    expect(p.rows.map(r => r.name)).toEqual(['キャベツ', '玉ねぎ', '豚バラ'])
    expect(p.metaRows.map(m => m.name)).toEqual(['【野菜】', '小計', '【精肉】', '合計'])
    expect(p.metaRows[0]).toMatchObject({ line: 2, reason: '区分の見出しに見えます' })
    expect(p.metaRows[1].reason).toContain('小計')
    // 「重複」として黙って落ちるのではなく、外したことが件数に出る
    expect(p.duplicates).toBe(0)
  })

  it('keepMeta を立てれば元どおり全部入る（本当に「小計」という品目のため）', () => {
    const p = parseItemCSV(DIRTY, { keepMeta: true })
    expect(p.rows.map(r => r.name)).toEqual(
      ['【野菜】', 'キャベツ', '玉ねぎ', '小計', '【精肉】', '豚バラ', '合計'])
    expect(p.metaRows).toEqual([])
  })

  it('列指定取込でも同じ判断が効く', () => {
    const p = parseMappedCSV('小計,420\nキャベツ,180', { name: 0, price: 1 }, { hasHeader: false })
    expect(p.rows.map(r => r.name)).toEqual(['キャベツ'])
    expect(p.metaRows[0]).toMatchObject({ line: 1, name: '小計' })
  })

  it('summaryCounts に外した行数が出る', () => {
    const c = summaryCounts(plan(DIRTY).summary)
    expect(c).toMatchObject({ added: 3, metaRows: 4 })
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

  it('列数がヘッダと一致しない行は、読めた列だけ使って取り込み、行番号を残す', () => {
    // 前置き（社名だけの行）のある帳票では必ず出る。ここで行ごと弾くと表本体まで巻き添えになる。
    const p = parseItemCSV(`${HEAD}\nトマト,箱,120,野菜,\nレタス,玉,120`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(p.rows[1].price).toBe(120)
    expect(p.columnMismatch[0]).toMatchObject({ line: 3, columnLabel: '列数' })
    expect(p.columnMismatch[0].reason).toContain('読めた列だけ')
    expect(p.errors).toEqual([])
  })

  it('名前の列すら取れない前置きの行は「品目名が空」で外れる', () => {
    const p = parseItemCSV(`${HEAD}\n東西酒販\nトマト,箱,120,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['東西酒販', 'トマト'])
    // 1列だけの行でも名前は取れるので品目になる。名前が空の行だけが外れる。
    const q = parseItemCSV(`${HEAD}\n,,,,\nトマト,箱,120,野菜,`)
    expect(q.rows.map(r => r.name)).toEqual(['トマト'])
    expect(q.skipped[0]).toMatchObject({ line: 2 })
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

// 別名（エイリアス）の取込は止めた。
// 列は位置で決めているのに5列目が「エイリアス」かどうかを列名で確かめておらず、
// 5列目が別の意味を持つファイルでは全行の値が別名として読まれ、1つの値を多数の品目が
// 取り合う＝全件衝突になっていた（実データで1093件）。
// ここでは「ファイルから別名を増やさない」「既存の別名は壊さない」を固定する。
describe('エイリアスは取り込まない', () => {
  const withAlias = () => emptyConfig({
    order: ['トマト', 'レタス'],
    dictionary: { あかいやつ: 'トマト' },
  })

  it('5列目に何が入っていても別名にしない（衝突も起きない）', () => {
    const p = plan(`${HEAD}\nレタス,玉,,,"あかいやつ"`, withAlias())
    expect(p.summary.aliasConflicts).toEqual([])
    expect(p.dictionary['あかいやつ']).toBe('トマト')   // 既存の持ち主のまま
  })

  it('関係のない値が並ぶ列でも、別名が量産されない', () => {
    // 5列目が「規格」など別の意味を持つファイル（今回の不具合の再現）
    const csv = [
      HEAD,
      'コーヒー豆,kg,,,"アイスコーヒー粉22"',
      'ホットコーヒー豆,kg,,,"アイスコーヒー粉22"',
      '昼ドリンク他,本,,,"ミル付きガンエン"',
    ].join('\n')
    const p = plan(csv, emptyConfig())
    expect(p.summary.aliasConflicts).toEqual([])
    expect(p.dictionary).toEqual({})
  })

  it('既存の別名は取込で消えない', () => {
    const p = plan(`${HEAD}\nトマト,箱,,,""`, withAlias())
    expect(p.dictionary['あかいやつ']).toBe('トマト')
  })

  it('旧2列フォーマット（品目名,エイリアス）でも品目名だけを読む', () => {
    const p = plan('品目名,エイリアス\nトマト,あかいやつ2', emptyConfig())
    expect(p.summary.added).toContain('トマト')
    expect(p.dictionary['あかいやつ2']).toBeUndefined()
  })

  it('全入れ替えで消える品目の別名は辞書からも落とす', () => {
    const p = plan(`${HEAD}\nレタス,玉,,,""`, withAlias(), { mode: IMPORT_MODE_REPLACE })
    expect(p.summary.removed).toEqual(['トマト'])
    expect(p.dictionary['あかいやつ']).toBeUndefined()
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

  it('summaryCounts が読めなかった欄・alias衝突・切り詰めも数える', () => {
    const p = plan(`${HEAD}\nトマト,箱,あ,野菜,\nレタス,玉,120,野菜,`)
    const c = summaryCounts(p.summary)
    // 行は2件とも入る。読めなかったのは欄1つぶん
    expect(c).toMatchObject({ added: 2, errors: 0, unreadable: 1, aliasConflicts: 0, truncatedNames: 0 })
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

describe('数量・単価の上限（Worker契約と同じ値）', () => {
  const REORDER_HEAD = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点'

  it('単価の上限ちょうどは受理する', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,100000000,野菜,`)
    expect(p.errors).toEqual([])
    expect(p.rows[0].price).toBe(100_000_000)
  })

  it('単価が上限+1なら、その欄だけ落として元の値・理由を残す', () => {
    const p = parseItemCSV(`${HEAD}\nトマト,箱,100000001,野菜,\nレタス,玉,120,野菜,`)
    expect(p.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(p.rows[0].price).toBeUndefined()
    expect(p.unreadable[0]).toMatchObject({ line: 2, columnLabel: '単価', value: '100000001', name: 'トマト' })
  })

  it('上限超過の単価は既存の単価を書き換えない（計画にも反映しない）', () => {
    const cfg = emptyConfig({ order: ['トマト'], prices: { トマト: 500 } })
    const p = plan(`${HEAD}\nトマト,箱,100000001,野菜,\nレタス,玉,120,野菜,`, cfg)
    expect(p.prices['トマト']).toBe(500)
    expect(p.summary.unreadable).toHaveLength(1)
  })

  it('発注点の上限ちょうどは受理し、上限+1はその欄だけ落とす', () => {
    const ok = parseItemCSV(`${REORDER_HEAD}\nトマト,箱,120,野菜,,,,,,,,1000000`)
    expect(ok.unreadable).toEqual([])
    expect(ok.rows[0].reorderPoint).toBe(1_000_000)

    const ng = parseItemCSV(`${REORDER_HEAD}\nトマト,箱,120,野菜,,,,,,,,1000001\nレタス,玉,90,野菜,,,,,,,,4`)
    expect(ng.rows.map(r => r.name)).toEqual(['トマト', 'レタス'])
    expect(ng.unreadable[0]).toMatchObject({ line: 2, columnLabel: '発注点', value: '1000001' })
  })

  it('列指定取込でも同じ上限が効く（欄だけ落ちる）', () => {
    const p = parseMappedCSV('トマト,箱,100000001', { name: 0, unit: 1, price: 2 }, { hasHeader: false })
    expect(p.rows.map(r => r.name)).toEqual(['トマト'])
    expect(p.rows[0].price).toBeUndefined()
    expect(p.rows[0].unit).toBe('箱')
    expect(p.unreadable[0]).toMatchObject({ line: 1, columnLabel: '単価', value: '100000001' })
  })
})
