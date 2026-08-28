/**
 * 完了失敗時に返す診断（`DEBUG_ERRORS=1` の検証環境だけ）。
 *
 * 端末側からは「503 でした」までしか分からず、Worker のログも見られないため、
 * 応答へ原因の要約を載せている。ここで固定するのは2つ。
 *
 *  1. **本番（既定）では detail を返さない**。DBのエラー文面はスキーマの手掛かりを含む。
 *  2. `too many terms in compound SELECT` のときだけ、実D1の数え方を測る
 *     **読み取りだけのプローブ**を添える。明細の INSERT は 19 行ずつに切ってあるので、
 *     このエラーが出る時点で「1文あたり 500」という前提が成り立っていない。
 *     どこが違うのか（1文の上限が小さいのか、batch 全体で累計されるのか）を
 *     現地で切り分けるための計測で、**書き込みは一切やり直さない**。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createD1, makeInventory } from './d1Harness.js'
import { handleSessionComplete, setDebugErrors } from '../src/storeHandler.js'

const CODE = 'SHOPDG'
const SID  = '22222222-2222-4222-8222-222222222222'

const COMPOUND = 'D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR'

function setup() {
  const h = createD1()
  h.seedStore(CODE, { sessionId: SID })
  return h
}

function bodyFor(inv) {
  return {
    inventory: inv,
    takenAt: '2026-08-28',
    snapshot: {
      sessionId: SID,
      items: Object.entries(inv).map(([item, v]) => ({ item, qty: v.qty, unit: v.unit })),
    },
  }
}

afterEach(() => setDebugErrors(false))

describe('完了失敗時の診断', () => {
  it('既定では detail を返さない（本番でスキーマを漏らさない）', async () => {
    const h = setup()
    h.failBatchAt(0, COMPOUND)
    const res = await handleSessionComplete(h.db, CODE, SID, bodyFor(makeInventory(3)))

    expect(res._status).toBe(503)
    expect(res.code).toBe('complete_failed')
    expect(res.detail).toBeUndefined()
  })

  it('検証環境では原因と batch の構成を返す', async () => {
    const h = setup()
    setDebugErrors(true)
    h.failBatchAt(0)
    const res = await handleSessionComplete(h.db, CODE, SID, bodyFor(makeInventory(40)))

    expect(res._status).toBe(503)
    expect(res.detail).toContain('injected failure')
    // 40品目 = 19行ずつで3文（+ DELETE 1文）
    expect(res.detail).toMatch(/lines=4\b/)
    expect(res.detail).toMatch(/items=40\b/)
    // compound 以外の失敗でプローブは走らせない（無駄なクエリを消費しない）
    expect(res.detail).not.toContain('s19=')
  })

  it('compound SELECT の失敗だけ、実DBの上限を測って添える', async () => {
    const h = setup()
    setDebugErrors(true)
    h.failBatchAt(0, COMPOUND)
    const res = await handleSessionComplete(h.db, CODE, SID, bodyFor(makeInventory(40)))

    expect(res._status).toBe(503)
    expect(res.detail).toContain('too many terms in compound SELECT')
    // 既定の SQLite は 500 まで通り 501 で落ちる。batch 累計では落ちない
    expect(res.detail).toContain('s19=ok')
    expect(res.detail).toContain('s500=ok')
    expect(res.detail).toContain('s501=NG')
    expect(res.detail).toContain('b27=ok')
  })

  it('プローブは書き込みをやり直さない（明細も履歴も残らない）', async () => {
    const h = setup()
    setDebugErrors(true)
    h.failBatchAt(0, COMPOUND)
    await handleSessionComplete(h.db, CODE, SID, bodyFor(makeInventory(40)))

    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(0)
    expect(h.rows('SELECT * FROM store_history')).toHaveLength(0)
    expect(h.rows('SELECT * FROM session_completions')).toHaveLength(0)
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SID)[0].status).toBe('active')
  })
})
