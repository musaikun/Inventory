// 完了要求のバイト上限。
//
// 変更履歴の上限を外したので、品目数の多い店舗では snapshot が 1MB（server の
// MAX_PAYLOAD_BYTES）を超えうる。超えると 413 で**棚卸の完了そのものが失敗**し、
// ユーザーには「保存できなかった」しか残らない。
// 収まらない分は変更履歴の古い方だけを落とし、数量・参加者別は必ず残す。
import { describe, it, expect } from 'vitest'
import {
  buildCompletionRequest, fitCompletionBody, MAX_COMPLETION_BYTES,
} from './sessionCompletion.js'

const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length

const auditEntries = (n) => Array.from({ length: n }, (_, i) => ({
  id: `entry-${i}`,
  ingredient: `品目${i % 500}`,
  action: 'overwrite',
  delta: 1,
  totalQty: 5,
  unit: '個',
  enteredBy: '端末A',
  enteredById: 'dev-aaaaaaaa',
  timestamp: 1_700_000_000_000 + i,
}))

describe('fitCompletionBody', () => {
  it('上限に収まっていれば何も落とさない', () => {
    const body = { snapshot: { auditLog: auditEntries(10) } }
    expect(fitCompletionBody(body)).toBe(0)
    expect(body.snapshot.auditLog).toHaveLength(10)
  })

  it('超えたら古い方から落として上限内に収める', () => {
    const body = { snapshot: { auditLog: auditEntries(20_000) } }
    expect(bytes(body)).toBeGreaterThan(MAX_COMPLETION_BYTES)

    const dropped = fitCompletionBody(body)
    expect(dropped).toBeGreaterThan(0)
    expect(bytes(body)).toBeLessThanOrEqual(MAX_COMPLETION_BYTES)
    // 残るのは新しい方
    expect(body.snapshot.auditLog.at(-1).id).toBe('entry-19999')
    expect(body.snapshot.auditLog).toHaveLength(20_000 - dropped)
  })

  it('変更履歴が無くても壊れない', () => {
    expect(fitCompletionBody({ snapshot: {} })).toBe(0)
    expect(fitCompletionBody({})).toBe(0)
    expect(fitCompletionBody(null)).toBe(0)
  })
})

describe('buildCompletionRequest はサイズ超過でも完了を止めない', () => {
  const inventory = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [`品目${i}`, { qty: i + 1, unit: '個' }]),
  )
  const snapshot = (auditLog) => ({
    date: '2026-08-09',
    sessionId: 'sess-1',
    items: Object.keys(inventory).map((item, i) => ({
      item, qty: i + 1, unit: '個', unitPrice: 100, subtotal: (i + 1) * 100,
      code: '', flagged: false, category: null, lotSize: '', prevMonth: '', tagA: '', tagB: '',
    })),
    totalValue: 1000,
    entryLog: Object.keys(inventory),
    participants: null,
    flaggedItems: [],
    auditLog,
    activeMs: 1000,
    axisNames: ['', ''],
  })

  it('通常の件数はそのまま送る', () => {
    const req = buildCompletionRequest({ snapshot: snapshot(auditEntries(600)), inventory, prices: {} })
    expect(req.ok).toBe(true)
    expect(req.droppedAuditEntries).toBe(0)
    expect(req.body.snapshot.auditLog).toHaveLength(600)
  })

  it('超過分は変更履歴だけを落とし、数量は全件残す', () => {
    const req = buildCompletionRequest({ snapshot: snapshot(auditEntries(20_000)), inventory, prices: {} })
    expect(req.ok).toBe(true)
    expect(req.droppedAuditEntries).toBeGreaterThan(0)
    expect(bytes(req.body)).toBeLessThanOrEqual(MAX_COMPLETION_BYTES)
    // 数量（明細・items）は欠けない。ここが欠けると棚卸の結果自体が保存できない
    expect(Object.keys(req.body.inventory)).toHaveLength(300)
    expect(req.body.snapshot.items).toHaveLength(300)
  })
})
