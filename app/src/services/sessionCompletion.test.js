// 完了要求の組み立て（DATA-001 / App第2セッション §2）
//
// 第1修正セッションが確定した stock/order 別の完了契約（DATA-002 §1・api-design §3.1）を
// App 側で固定する。ここを通らない完了要求は本番に存在しない。
//
//  - stock … `{ inventory, prices, takenAt, snapshot }`。snapshot 必須。
//            `takenAt` と `snapshot.date` は必ず一致（不一致は server 400 snapshot_date_mismatch）
//  - order … `{ itemCount }` **だけ**。snapshot も非空 inventory も送れない
//            （送ると server 400 snapshot_not_allowed）
//  - 組み立てられない要求は API を呼ばない
import { describe, it, expect } from 'vitest'
import {
  buildCompletionRequest, completionErrorMessage,
  COMPLETION_STOCK, COMPLETION_ORDER,
} from './sessionCompletion.js'

const TODAY = '2026-08-17'
const SNAP = (over = {}) => ({
  date: TODAY,
  sessionId: 'sess-1',
  items: [
    { item: 'トマト', qty: 3, unit: '個' },
    { item: 'きゅうり', qty: null, unit: '本' },   // 未入力（表示用に残る）
  ],
  ...over,
})
const INV = { トマト: { qty: 3, unit: '個' } }

describe('buildCompletionRequest — stock', () => {
  it('snapshot 付きの完了APIペイロードを作る', () => {
    const r = buildCompletionRequest({
      sessionType: 'stock', snapshot: SNAP(), inventory: INV, prices: { トマト: 100 },
    })
    expect(r.ok).toBe(true)
    expect(r.type).toBe(COMPLETION_STOCK)
    expect(r.body.snapshot.sessionId).toBe('sess-1')
    expect(r.body.inventory).toEqual(INV)
    expect(r.body.prices).toEqual({ トマト: 100 })
  })

  it('takenAt と snapshot.date を必ず一致させる', () => {
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: SNAP(), inventory: INV })
    expect(r.body.takenAt).toBe(TODAY)
    expect(r.body.snapshot.date).toBe(r.body.takenAt)
  })

  it('snapshot.date が不正なら組み立てない', () => {
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: SNAP({ date: '2026-02-30' }), inventory: INV })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_date')
    expect(r.body).toBeUndefined()
  })

  it('明細が無ければ完了要求を作らない（server の empty_inventory を踏ませない）', () => {
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: null, inventory: {} })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_inventory')
    expect(r.body).toBeUndefined()
  })

  it('items が空の snapshot は「明細あり」と扱わない', () => {
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: SNAP({ items: [] }), inventory: INV })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('snapshot_build_failed')
  })

  it('sessionId を持たない snapshot は送らない', () => {
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: SNAP({ sessionId: null }), inventory: INV })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('snapshot_without_session')
  })

  // server は qty を持つ items の集合と inventory 行の集合が一致しないと
  // 400 snapshot_mismatch（何も書かない）。送る前に同じ判定をする。
  it('snapshot が inventory に無い品目の数量を主張したら送らない', () => {
    const snap = SNAP({ items: [{ item: 'トマト', qty: 3 }, { item: 'なす', qty: 5 }] })
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: snap, inventory: INV })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('snapshot_mismatch')
  })

  it('inventory にある品目が snapshot から欠けていたら送らない', () => {
    const r = buildCompletionRequest({
      sessionType: 'stock', snapshot: SNAP(),
      inventory: { ...INV, なす: { qty: 5, unit: '個' } },
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('snapshot_mismatch')
  })

  // server は品目名を 200 文字で切り、切り詰め後に重複した行を落とす。
  // client がそのまま送ると snapshot 側だけ2件になり 400 になる。
  it('200文字で切り詰めると衝突する品目名は、送る前に理由を返す', () => {
    const base = 'あ'.repeat(200)
    const a = base + 'X'
    const b = base + 'Y'
    const snap = SNAP({ items: [{ item: a, qty: 1 }, { item: b, qty: 2 }] })
    const r = buildCompletionRequest({
      sessionType: 'stock', snapshot: snap, inventory: { [a]: { qty: 1 }, [b]: { qty: 2 } },
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('duplicate_item_name')
  })

  it('未入力（qty:null）の品目は一致判定に含めない', () => {
    const r = buildCompletionRequest({ sessionType: 'stock', snapshot: SNAP(), inventory: INV })
    expect(r.ok).toBe(true)
    expect(r.body.snapshot.items.some(i => i.qty === null)).toBe(true)
  })
})

describe('buildCompletionRequest — order', () => {
  it('発注は itemCount だけを送る', () => {
    const r = buildCompletionRequest({ sessionType: 'order', orderCount: 12, snapshot: null, inventory: {} })
    expect(r.ok).toBe(true)
    expect(r.type).toBe(COMPLETION_ORDER)
    expect(r.body).toEqual({ itemCount: 12 })
    expect(r.snapshot).toBeNull()
  })

  // server は snapshot / 非空 inventory を 400 snapshot_not_allowed で拒否する。
  // 在庫を入力していても発注セッションでは送らない（正本は orders / order_lines）。
  it('在庫を入力していても snapshot と inventory を送らない', () => {
    const r = buildCompletionRequest({
      sessionType: 'order', orderCount: 3, snapshot: SNAP(), inventory: INV,
    })
    expect(r.ok).toBe(true)
    expect(r.type).toBe(COMPLETION_ORDER)
    expect(r.body).toEqual({ itemCount: 3 })
    expect(r.body).not.toHaveProperty('snapshot')
    expect(r.body).not.toHaveProperty('inventory')
  })

  it('架空の snapshot / marker を作らない', () => {
    const r = buildCompletionRequest({ sessionType: 'order', orderCount: 0, inventory: {} })
    expect(r.snapshot).toBeNull()
    expect(JSON.stringify(r.body)).not.toContain('items')
  })

  it('件数が数値でなければ送らない', () => {
    const r = buildCompletionRequest({ sessionType: 'order', orderCount: NaN })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_order_count')
  })

  it('上限を超える件数は送らない', () => {
    const r = buildCompletionRequest({ sessionType: 'order', orderCount: 5001 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_order_count')
  })
})

describe('completionErrorMessage', () => {
  it('理由ごとに説明可能な文言を返す', () => {
    expect(completionErrorMessage('no_inventory')).toContain('明細')
    expect(completionErrorMessage('snapshot_mismatch')).toBeTruthy()
    expect(completionErrorMessage('duplicate_item_name')).toContain('品目名')
    expect(completionErrorMessage('unknown-reason')).toBeTruthy()
  })
})
