import { describe, it, expect, beforeEach } from 'vitest'
import { fingerprintTokens, saveProfile, deleteProfile, listProfiles, matchProfile } from './pdfProfiles.js'

beforeEach(() => localStorage.clear())

// 同じ帳票（列位置は同じ・品目名や値だけ違う）を模したトークン群
function tokensA() {
  return [
    { text: '品目コード', x: 60, y: 714 }, { text: '品目名', x: 122, y: 714 },
    { text: '単価', x: 420, y: 714 }, { text: '数量', x: 482, y: 714 },
    { text: '1001', x: 60, y: 688 }, { text: 'コーヒー豆', x: 122, y: 688 },
    { text: '980', x: 463, y: 688 }, { text: '40', x: 519, y: 688 },
  ]
}
// 翌月の同帳票（品目名・値は違うが列xは同一）
function tokensANextMonth() {
  return [
    { text: '品目コード', x: 60, y: 714 }, { text: '品目名', x: 122, y: 714 },
    { text: '単価', x: 420, y: 714 }, { text: '数量', x: 482, y: 714 },
    { text: '3050', x: 60, y: 688 }, { text: '紅茶葉', x: 122, y: 688 },
    { text: '1250', x: 463, y: 688 }, { text: '12', x: 519, y: 688 },
  ]
}
// 別レイアウト（列位置が大きく違う）
function tokensB() {
  return [
    { text: 'Code', x: 214, y: 739 }, { text: 'Item', x: 253, y: 739 },
    { text: 'Qty', x: 331, y: 739 }, { text: 'Unit', x: 361, y: 739 },
    { text: 'A001', x: 214, y: 721 }, { text: 'Coffee', x: 253, y: 721 },
    { text: '12', x: 331, y: 721 }, { text: 'bag', x: 361, y: 721 },
  ]
}

describe('fingerprintTokens', () => {
  it('品目名や値が変わっても同レイアウトなら同一指紋になる', () => {
    expect(fingerprintTokens(tokensA())).toEqual(fingerprintTokens(tokensANextMonth()))
  })
  it('別レイアウトは指紋が異なる', () => {
    expect(fingerprintTokens(tokensA())).not.toEqual(fingerprintTokens(tokensB()))
  })
  it('空入力は空配列', () => {
    expect(fingerprintTokens([])).toEqual([])
    expect(fingerprintTokens(null)).toEqual([])
  })
})

describe('保存・一覧・削除', () => {
  it('保存したレシピが一覧に出る', () => {
    const rec = saveProfile({ name: '仕入先A', columns: [{ field: 'name', x: 122 }], fromY: 700, fingerprint: fingerprintTokens(tokensA()) })
    const list = listProfiles()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(rec.id)
    expect(list[0].name).toBe('仕入先A')
  })
  it('同一指紋の再保存は置き換え（重複しない）', () => {
    saveProfile({ name: '旧', columns: [], fromY: 700, fingerprint: fingerprintTokens(tokensA()) })
    saveProfile({ name: '新', columns: [], fromY: 700, fingerprint: fingerprintTokens(tokensANextMonth()) })
    const list = listProfiles()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('新')
  })
  it('別指紋は別レシピとして追加される', () => {
    saveProfile({ name: 'A', columns: [], fromY: 0, fingerprint: fingerprintTokens(tokensA()) })
    saveProfile({ name: 'B', columns: [], fromY: 0, fingerprint: fingerprintTokens(tokensB()) })
    expect(listProfiles()).toHaveLength(2)
  })
  it('削除できる', () => {
    const rec = saveProfile({ name: 'X', columns: [], fromY: 0, fingerprint: fingerprintTokens(tokensA()) })
    deleteProfile(rec.id)
    expect(listProfiles()).toHaveLength(0)
  })
})

describe('matchProfile', () => {
  it('同レイアウトの翌月ファイルを一致させる', () => {
    const rec = saveProfile({ name: 'A', columns: [{ field: 'name', x: 122 }], fromY: 700, fingerprint: fingerprintTokens(tokensA()) })
    const m = matchProfile(tokensANextMonth())
    expect(m).not.toBeNull()
    expect(m.id).toBe(rec.id)
  })
  it('別レイアウトはしきい値未満で null', () => {
    saveProfile({ name: 'A', columns: [], fromY: 0, fingerprint: fingerprintTokens(tokensA()) })
    expect(matchProfile(tokensB())).toBeNull()
  })
  it('保存が無ければ null', () => {
    expect(matchProfile(tokensA())).toBeNull()
  })
})
