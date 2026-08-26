// 参加者別の集計と品目ごとの履歴。
//
// 要件（User）:
//   ・誰が参加していたか
//   ・それぞれの参加者が何品目登録したか（**重複あり**。品目Aを登録したあと
//     別の担当者が同じ品目Aを変更したら、それぞれ1品目として加算）
//   ・重複して変更があった品目が分かること
//   ・品目ごとの変更履歴（タイムスタンプのベタ書きでは調査に使えないため）
import { describe, it, expect } from 'vitest'
import {
  participantStats, itemHistory, sharedItemCounts, toEpochMs, isQtyAction,
} from './participantStats.js'

const T = 1_700_000_000_000
const e = (id, item, by, byId, action, totalQty, at) => ({
  id, ingredient: item, action, delta: 0, totalQty, unit: '個',
  enteredBy: by, enteredById: byId, timestamp: at,
})

// A が トマト・レタス、B が トマト（Aのあとに変更）・キャベツ
const log = [
  e('1', 'トマト',   '端末A', 'dev-a', 'new',       3, T),
  e('2', 'レタス',   '端末A', 'dev-a', 'new',       5, T + 60_000),
  e('3', 'トマト',   '端末B', 'dev-b', 'overwrite', 8, T + 120_000),
  e('4', 'キャベツ', '端末B', 'dev-b', 'new',       2, T + 180_000),
]
const snapshot = {
  auditLog: log,
  items: [
    { item: 'トマト',   qty: 8, unit: '個', subtotal: 800 },
    { item: 'レタス',   qty: 5, unit: '個', subtotal: 500 },
    { item: 'キャベツ', qty: 2, unit: '個', subtotal: 200 },
  ],
}

describe('toEpochMs', () => {
  it('数値・数値文字列・ISO文字列を epoch ms へ揃える', () => {
    expect(toEpochMs(T)).toBe(T)
    // server を経由すると数値が文字列で返ることがある（Invalid Date の原因）
    expect(toEpochMs(String(T))).toBe(T)
    expect(toEpochMs('2026-08-09T10:00:00.000Z')).toBe(Date.parse('2026-08-09T10:00:00.000Z'))
    expect(toEpochMs('')).toBe(null)
    expect(toEpochMs(null)).toBe(null)
    expect(toEpochMs('あした')).toBe(null)
  })
})

describe('isQtyAction', () => {
  it('数量を変える操作だけ数える（フラグ・発注は除く）', () => {
    expect(isQtyAction('new')).toBe(true)
    expect(isQtyAction('overwrite')).toBe(true)
    expect(isQtyAction('remove')).toBe(true)
    expect(isQtyAction('flag_recount')).toBe(false)
    expect(isQtyAction('order_set')).toBe(false)
  })
})

describe('participantStats', () => {
  it('参加者ごとに操作件数を重複ありで数える', () => {
    const stats = participantStats(snapshot)
    expect(stats.map(p => [p.name, p.count])).toEqual([['端末A', 2], ['端末B', 2]])
    // トマトは2人が触っているので、A・B それぞれで1件ずつ数える
    expect(stats.find(p => p.name === '端末A').entries.map(x => x.item)).toEqual(['トマト', 'レタス'])
    expect(stats.find(p => p.name === '端末B').entries.map(x => x.item)).toEqual(['トマト', 'キャベツ'])
  })

  it('同じ人が同じ品目を何度も直したぶんも件数に入る', () => {
    const stats = participantStats({
      ...snapshot,
      auditLog: [
        e('1', 'トマト', '端末A', 'dev-a', 'new', 3, T),
        e('2', 'トマト', '端末A', 'dev-a', 'overwrite', 5, T + 1000),
        e('3', 'トマト', '端末A', 'dev-a', 'overwrite', 9, T + 2000),
      ],
    })
    expect(stats[0].count).toBe(3)       // 操作は3件
    expect(stats[0].itemCount).toBe(1)   // 品目としては1つ
    expect(stats[0].sharedCount).toBe(0) // 他の人は触っていない
  })

  it('他の担当者も触った品目に印を付ける', () => {
    const stats = participantStats(snapshot)
    const a = stats.find(p => p.name === '端末A')
    expect(a.sharedCount).toBe(1)
    expect(a.entries.find(x => x.item === 'トマト').shared).toBe(true)
    expect(a.entries.find(x => x.item === 'レタス').shared).toBe(false)
  })

  it('金額は最後に入力した人にだけ計上する（重複させない）', () => {
    const stats = participantStats(snapshot)
    // トマト(800)は最後に触った B。A はレタス(500)だけ
    expect(stats.find(p => p.name === '端末A').totalValue).toBe(500)
    expect(stats.find(p => p.name === '端末B').totalValue).toBe(1000)
  })

  it('操作は時系列（古い順）で、稼働時間は最初〜最後の差', () => {
    const a = participantStats(snapshot).find(p => p.name === '端末A')
    expect(a.entries.map(x => x.at)).toEqual([T, T + 60_000])
    expect(a.activeMs).toBe(60_000)
  })

  it('1件しか操作していない人の稼働時間は出さない', () => {
    const stats = participantStats({ ...snapshot, auditLog: [log[0]] })
    expect(stats[0].activeMs).toBe(null)
  })

  it('件数の多い順に並べる', () => {
    const stats = participantStats({
      ...snapshot,
      auditLog: [...log, e('5', 'ナス', '端末B', 'dev-b', 'new', 1, T + 240_000)],
    })
    expect(stats.map(p => p.name)).toEqual(['端末B', '端末A'])
  })

  it('数量を変えない操作は数えない', () => {
    const stats = participantStats({
      ...snapshot,
      auditLog: [log[0], e('f', 'トマト', '端末A', 'dev-a', 'flag_recount', 3, T + 10)],
    })
    expect(stats[0].count).toBe(1)
  })

  it('enteredById が無い古いログは名前でまとめる', () => {
    const stats = participantStats({
      ...snapshot,
      auditLog: [
        e('1', 'トマト', '端末A', '', 'new', 3, T),
        e('2', 'レタス', '端末A', '', 'new', 5, T + 1000),
      ],
    })
    expect(stats).toHaveLength(1)
    expect(stats[0].count).toBe(2)
  })

  it('auditLog が無ければ保存済みの participants へ落とす（近似と印を付ける）', () => {
    const stats = participantStats({
      auditLog: [],
      participants: [{ name: '端末A', items: [{ item: 'トマト', qty: 3, unit: '個', at: T }], totalValue: 300 }],
    })
    expect(stats).toEqual([expect.objectContaining({
      name: '端末A', count: 1, itemCount: 1, sharedCount: 0, totalValue: 300, approximate: true,
    })])
  })

  it('どちらも無ければ空', () => {
    expect(participantStats({})).toEqual([])
    expect(participantStats(null)).toEqual([])
  })
})

describe('itemHistory', () => {
  it('その品目の変更だけを新しい順で返す', () => {
    const h = itemHistory(snapshot, 'トマト')
    expect(h.map(x => [x.by, x.qty])).toEqual([['端末B', 8], ['端末A', 3]])
  })

  it('フラグ操作も含める（品目に何が起きたかを1画面で追うため）', () => {
    const h = itemHistory({
      auditLog: [...log, e('f', 'トマト', '端末A', 'dev-a', 'flag_recount', 8, T + 300_000)],
    }, 'トマト')
    expect(h[0].action).toBe('flag_recount')
  })

  it('履歴が無い品目は空', () => {
    expect(itemHistory(snapshot, '存在しない品目')).toEqual([])
    expect(itemHistory({}, 'トマト')).toEqual([])
  })
})

describe('sharedItemCounts', () => {
  it('品目ごとに触った担当者数を返す', () => {
    expect(sharedItemCounts(snapshot)).toEqual({ トマト: 2, レタス: 1, キャベツ: 1 })
  })
})
