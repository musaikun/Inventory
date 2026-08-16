import { describe, it, expect } from 'vitest'
import { parseResultCSV, isResultCSV, parseResultSnapshots } from './resultCsvParser.js'

const CSV_PRICED = [
  '日付,商品コード,品目名,単位,数量,単価,在庫金額',
  '"2026-06-30","4900000000001","豚バラ","kg",3,500,1500',
  '"2026-06-30","","ビール","本",24,200,4800',
  '"2026-06-30","","【合計】","",,,6300',
].join('\r\n')

const CSV_NOPRICE = [
  '日付,商品コード,品目名,単位,数量',
  '"2026-06-30","","牛乳","本",5',
  '"2026-06-30","","空き品",,',   // 数量空 → スキップ
].join('\r\n')

describe('resultCsvParser', () => {
  describe('isResultCSV', () => {
    it('品目名＋数量列があれば true', () => {
      expect(isResultCSV(CSV_PRICED)).toBe(true)
      expect(isResultCSV(CSV_NOPRICE)).toBe(true)
    })
    it('品目リストCSV（数量なし）は false', () => {
      expect(isResultCSV('品目名,単位,単価\n豚バラ,kg,500')).toBe(false)
    })
    it('空文字は false', () => {
      expect(isResultCSV('')).toBe(false)
    })
  })

  describe('parseResultCSV', () => {
    it('品目名・数量・単位・コード・単価を抽出する', () => {
      const rows = parseResultCSV(CSV_PRICED)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({ name: '豚バラ', qty: 3, unit: 'kg', code: '4900000000001', price: 500, category: '', lotSize: '', prevMonth: '' })
      expect(rows[1]).toEqual({ name: 'ビール', qty: 24, unit: '本', code: '', price: 200, category: '', lotSize: '', prevMonth: '' })
    })

    it('【合計】行はスキップする', () => {
      const rows = parseResultCSV(CSV_PRICED)
      expect(rows.find(r => r.name.includes('合計'))).toBeUndefined()
    })

    it('数量が空の行はスキップする', () => {
      const rows = parseResultCSV(CSV_NOPRICE)
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('牛乳')
      expect(rows[0].qty).toBe(5)
      expect(rows[0].price).toBeNull()
    })

    it('列順が違っても（ヘッダ名で特定）動く', () => {
      const csv = ['品目名,数量,単位\nトマト,8,個'].join('\n')
      const rows = parseResultCSV(csv)
      expect(rows[0]).toMatchObject({ name: 'トマト', qty: 8, unit: '個' })
    })

    it('品目名/数量列が無ければエラー', () => {
      expect(() => parseResultCSV('品目名,単位\n豚バラ,kg')).toThrow()
    })

    it('数量データが無ければエラー', () => {
      expect(() => parseResultCSV('品目名,数量\n豚バラ,\nビール,')).toThrow()
    })
  })

  describe('parseResultSnapshots（過去棚卸の日付グルーピング）', () => {
    it('日付ごとにスナップショットへ束ねる', () => {
      const csv = [
        '日付,商品コード,品目名,単位,数量,単価,在庫金額',
        '2026-05-31,,豚バラ,kg,2,500,1000',
        '2026-05-31,,ビール,本,10,200,2000',
        '2026/6/30,,豚バラ,kg,3,500,1500',
        '2026-06-30,,【合計】,,,,',
      ].join('\n')
      const { snapshots: snaps, errors } = parseResultSnapshots(csv)
      expect(errors).toEqual([])
      expect(snaps).toHaveLength(2)
      expect(snaps[0].date).toBe('2026-05-31')
      expect(snaps[0].items).toEqual([
        { item: '豚バラ', qty: 2, unit: 'kg', unitPrice: 500, code: '', category: null, lotSize: '', prevMonth: '' },
        { item: 'ビール', qty: 10, unit: '本', unitPrice: 200, code: '', category: null, lotSize: '', prevMonth: '' },
      ])
      expect(snaps[1]).toMatchObject({ date: '2026-06-30' })
      expect(snaps[1].items).toHaveLength(1)
    })

    it('日付列が無ければエラー', () => {
      expect(() => parseResultSnapshots('品目名,数量\n豚バラ,3')).toThrow(/日付/)
    })

    it('有効な日付行が無ければエラー', () => {
      expect(() => parseResultSnapshots('日付,品目名,数量\n,豚バラ,3')).toThrow(/見つかりません/)
    })
  })
})

describe('数値の解釈 — 品目取込・納品取込と同じ契約', () => {
  const csv = (...lines) => ['日付,品目名,単位,数量,単価', ...lines].join('\n')

  describe('parseResultCSV（結果CSVから復元）', () => {
    const rcsv = (...lines) => ['品目名,単位,数量,単価', ...lines].join('\n')

    it('12abc / 1,20 / -100 / abc100 を黙って正常値へ変換しない', () => {
      // 桁区切りに見える不正値はセルが割れないよう引用符で囲んで渡す
      for (const bad of ['12abc', '"1,20"', '-100', 'abc100', 'NaN', 'Infinity']) {
        expect(() => parseResultCSV(rcsv(`豚バラ,kg,${bad},500`)), bad).toThrow(/読めない|0以上/)
      }
    })

    it('不正な単価も同じく拒否する（負単価を通さない）', () => {
      expect(() => parseResultCSV(rcsv('豚バラ,kg,2,-100'))).toThrow()
      expect(() => parseResultCSV(rcsv('豚バラ,kg,2,12abc'))).toThrow()
    })

    it('拒否する例外は行番号・列名・元の値・理由を持つ', () => {
      let err
      try { parseResultCSV(rcsv('豚バラ,kg,2,500', 'ビール,本,12abc,200')) } catch (e) { err = e }
      expect(err.errors).toHaveLength(1)
      expect(err.errors[0]).toMatchObject({ line: 3, columnLabel: '数量', value: '12abc', name: 'ビール' })
      expect(err.message).toContain('3行目')
    })

    it('正しい 1,200 と小数は受理する', () => {
      const rows = parseResultCSV(rcsv('豚バラ,kg,"1,200",500', 'ビール,本,0.5,"1,200"'))
      expect(rows[0].qty).toBe(1200)
      expect(rows[1].qty).toBe(0.5)
      expect(rows[1].price).toBe(1200)
    })

    it('数量が空の行は不正ではなく未入力として飛ばす', () => {
      const rows = parseResultCSV(rcsv('豚バラ,kg,2,500', 'ビール,本,,200'))
      expect(rows).toHaveLength(1)
    })
  })

  describe('parseResultSnapshots（過去棚卸）', () => {
    it('読めない数量・単価は捨てずに errors へ入れ、正常行だけを snapshots にする', () => {
      const { snapshots, errors } = parseResultSnapshots(csv(
        '2026-05-31,豚バラ,kg,2,500',
        '2026-05-31,ビール,本,12abc,200',
        '2026-05-31,ワイン,本,3,-100',
      ))
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].items).toHaveLength(1)
      expect(errors).toHaveLength(2)
      expect(errors[0]).toMatchObject({ line: 3, columnLabel: '数量', value: '12abc', name: 'ビール' })
      expect(errors[1]).toMatchObject({ line: 4, columnLabel: '単価', value: '-100', name: 'ワイン' })
    })

    it('正しい 1,200 と小数は受理する', () => {
      const { snapshots, errors } = parseResultSnapshots(csv(
        '2026-05-31,豚バラ,kg,"1,200","1,500"',
        '2026-05-31,ビール,本,0.25,200',
      ))
      expect(errors).toEqual([])
      expect(snapshots[0].items[0]).toMatchObject({ qty: 1200, unitPrice: 1500 })
      expect(snapshots[0].items[1]).toMatchObject({ qty: 0.25 })
    })

    it('書いてあるのに読めない日付はエラーにする（1日ぶん黙って失わない）', () => {
      const { snapshots, errors } = parseResultSnapshots(csv(
        '2026-05-31,豚バラ,kg,2,500',
        '令和8年5月32日,ビール,本,3,200',
      ))
      expect(snapshots).toHaveLength(1)
      expect(errors[0]).toMatchObject({ line: 3, columnLabel: '日付' })
    })

    it('全行が不正なら理由つきで throw する（黙って0件にしない）', () => {
      let err
      try { parseResultSnapshots(csv('2026-05-31,豚バラ,kg,12abc,500')) } catch (e) { err = e }
      expect(err.errors).toHaveLength(1)
      expect(err.message).toContain('2行目')
    })
  })
})

describe('実在する日付だけを受理する（月日の範囲だけ見ない）', () => {
  const csv = (...lines) => ['日付,品目名,単位,数量,単価', ...lines].join('\n')

  it('閏年の2月29日は取り込む', () => {
    const { snapshots, errors } = parseResultSnapshots(csv('2024-02-29,豚バラ,kg,2,500'))
    expect(errors).toEqual([])
    expect(snapshots.map(s => s.date)).toEqual(['2024-02-29'])
  })

  it('平年の2月29日・2月30日・2月31日・4月31日は行エラーにする', () => {
    for (const bad of ['2025-02-29', '2026-02-30', '2026-02-31', '2026-04-31']) {
      const { snapshots, errors } = parseResultSnapshots(csv(
        '2026-05-31,豚バラ,kg,2,500',
        `${bad},ビール,本,3,200`,
      ))
      expect(snapshots.map(s => s.date), bad).toEqual(['2026-05-31'])
      expect(errors, bad).toHaveLength(1)
      expect(errors[0], bad).toMatchObject({ line: 3, columnLabel: '日付', value: bad, name: 'ビール' })
    }
  })

  it('既存の / . 年月日 表記は引き続き正規化する', () => {
    const { snapshots, errors } = parseResultSnapshots(csv(
      '2026/6/1,豚バラ,kg,2,500',
      '2026.6.2,ビール,本,3,200',
      '2026年6月3日,ワイン,本,1,900',
    ))
    expect(errors).toEqual([])
    expect(snapshots.map(s => s.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })
})

describe('数量・単価の上限（Worker契約と同じ値）', () => {
  const csv  = (...lines) => ['日付,品目名,単位,数量,単価', ...lines].join('\n')
  const rcsv = (...lines) => ['品目名,単位,数量,単価', ...lines].join('\n')

  it('過去棚卸: 上限ちょうどは受理し、上限+1は行エラーにする', () => {
    const ok = parseResultSnapshots(csv('2026-05-31,豚バラ,kg,1000000,100000000'))
    expect(ok.errors).toEqual([])
    expect(ok.snapshots[0].items[0]).toMatchObject({ qty: 1_000_000, unitPrice: 100_000_000 })

    const ng = parseResultSnapshots(csv(
      '2026-05-31,豚バラ,kg,2,500',
      '2026-05-31,ビール,本,1000001,200',
      '2026-05-31,ワイン,本,3,100000001',
    ))
    expect(ng.snapshots[0].items).toHaveLength(1)
    expect(ng.errors[0]).toMatchObject({ line: 3, columnLabel: '数量', value: '1000001', name: 'ビール' })
    expect(ng.errors[1]).toMatchObject({ line: 4, columnLabel: '単価', value: '100000001', name: 'ワイン' })
  })

  it('復元（確認画面なし）は上限超過があれば1件も取り込まない', () => {
    expect(parseResultCSV(rcsv('豚バラ,kg,1000000,100000000'))[0]).toMatchObject({ qty: 1_000_000 })

    let err
    try { parseResultCSV(rcsv('豚バラ,kg,2,500', 'ビール,本,1000001,200')) } catch (e) { err = e }
    expect(err.errors).toHaveLength(1)
    expect(err.errors[0]).toMatchObject({ line: 3, columnLabel: '数量', value: '1000001' })
  })
})
