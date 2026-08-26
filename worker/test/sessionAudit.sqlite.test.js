/**
 * 操作ログ（変更履歴）を D1 に持つ（migration 0017）。
 *
 * 商業利用では「誰が・何を・いつ変えたか」を後から辿れることに価値がある。
 * それまでの置き場所（Durable Object / 端末の localStorage）はどちらも
 * 記録の正本になり得なかった — DO はルームの生存期間に縛られ、端末は1台に依存する。
 *
 * ここで固定するのは4点:
 *   1. 同じ id の再送で行が増えない（端末はそのまま送り直せる）
 *   2. 他店舗のセッションへ記録を差し込めない
 *   3. セッション削除・履歴削除・アカウント削除で記録も消える
 *   4. table が無い環境（0017 未適用）でも読み出しが画面を壊さない
 *
 * 実SQLite（全migration適用）で動かす。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import { handleAuditAppend, handleAuditGet, handleSessionDelete, handleHistoryDelete } from '../src/storeHandler.js'
import { MAX_AUDIT_PER_REQUEST } from '../src/constants.js'

const CODE  = 'SHOPAA'
const OTHER = 'SHOPBB'
const SID   = '11111111-1111-4111-8111-111111111111'
const OSID  = '22222222-2222-4222-8222-222222222222'

const entry = (id, item, by, byId, at, extra = {}) => ({
  id, ingredient: item, action: 'overwrite', delta: 1, totalQty: 5,
  unit: '個', enteredBy: by, enteredById: byId, timestamp: at, ...extra,
})

function setup() {
  const h = createD1()
  h.seedStore(CODE, { sessionId: SID })
  h.seedStore(OTHER, { sessionId: OSID })
  return h
}

const auditRows = (h, code = CODE) =>
  h.rows('SELECT * FROM session_audit WHERE shop_code = ? ORDER BY at, id', code)

describe('操作ログの追記', () => {
  it('まとめて追記し、時系列で読み戻せる', async () => {
    const h = setup()
    const res = await handleAuditAppend(h.db, CODE, SID, {
      entries: [
        entry('e2', 'レタス', '端末A', 'dev-a', 2000),
        entry('e1', 'トマト', '端末A', 'dev-a', 1000),
        entry('e3', 'トマト', '端末B', 'dev-b', 3000),
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.saved).toBe(3)

    const log = await handleAuditGet(h.db, CODE, SID)
    expect(log.map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(log[0]).toMatchObject({
      ingredient: 'トマト', action: 'overwrite', totalQty: 5, unit: '個',
      enteredBy: '端末A', enteredById: 'dev-a', timestamp: 1000,
    })
  })

  // 端末は送信失敗時にそのままキューを送り直す。重複したら履歴が水増しされる。
  it('同じ id の再送で行が増えない（冪等）', async () => {
    const h = setup()
    const body = { entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)] }
    await handleAuditAppend(h.db, CODE, SID, body)
    await handleAuditAppend(h.db, CODE, SID, body)
    await handleAuditAppend(h.db, CODE, SID, body)
    expect(auditRows(h)).toHaveLength(1)
  })

  it('同じ要求の中の重複も1件に落とす', async () => {
    const h = setup()
    const res = await handleAuditAppend(h.db, CODE, SID, {
      entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000), entry('e1', 'トマト', '端末A', 'dev-a', 1000)],
    })
    expect(res.saved).toBe(1)
    expect(auditRows(h)).toHaveLength(1)
  })

  it('品目数を大きく超える件数を積める（1品目を複数人が直す）', async () => {
    const h = setup()
    for (let batch = 0; batch < 3; batch++) {
      const entries = Array.from({ length: 150 }, (_, i) =>
        entry(`b${batch}-${i}`, `品目${i % 20}`, `端末${i % 3}`, `dev-${i % 3}`, 1000 + batch * 1000 + i))
      const res = await handleAuditAppend(h.db, CODE, SID, { entries })
      expect(res.ok).toBe(true)
    }
    expect(auditRows(h)).toHaveLength(450)
  })

  it('1要求の上限を超えたら 413（黙って切り捨てない）', async () => {
    const h = setup()
    const entries = Array.from({ length: MAX_AUDIT_PER_REQUEST + 1 }, (_, i) =>
      entry(`e${i}`, 'トマト', '端末A', 'dev-a', 1000 + i))
    const res = await handleAuditAppend(h.db, CODE, SID, { entries })
    expect(res._status).toBe(413)
    expect(auditRows(h)).toHaveLength(0)
  })

  it('id・品目名・種別が欠けた行は捨てる', async () => {
    const h = setup()
    const res = await handleAuditAppend(h.db, CODE, SID, {
      entries: [
        { ...entry('e1', 'トマト', '端末A', 'dev-a', 1000), id: '' },
        { ...entry('e2', 'トマト', '端末A', 'dev-a', 1000), ingredient: '' },
        { ...entry('e3', 'トマト', '端末A', 'dev-a', 1000), action: '' },
        entry('e4', 'トマト', '端末A', 'dev-a', 1000),
      ],
    })
    expect(res.saved).toBe(1)
    expect(auditRows(h)[0].id).toBe('e4')
  })

  it('時刻が不正なら server 時刻へ落とす（行ごと捨てない）', async () => {
    const h = setup()
    await handleAuditAppend(h.db, CODE, SID, {
      entries: [{ ...entry('e1', 'トマト', '端末A', 'dev-a', 0), timestamp: 'あした' }],
    })
    const row = auditRows(h)[0]
    expect(typeof row.at).toBe('number')
    expect(row.at).toBeGreaterThan(0)
  })

  it('entries が無ければ 400', async () => {
    const h = setup()
    expect((await handleAuditAppend(h.db, CODE, SID, {}))._status).toBe(400)
    expect((await handleAuditAppend(h.db, CODE, '', { entries: [] }))._status).toBe(400)
  })
})

describe('店舗境界', () => {
  it('他店舗のセッションへは書けない', async () => {
    const h = setup()
    const res = await handleAuditAppend(h.db, CODE, OSID, {
      entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)],
    })
    expect(res._status).toBe(409)
    expect(auditRows(h, OTHER)).toHaveLength(0)
  })

  it('存在しないセッションは 404', async () => {
    const h = setup()
    const res = await handleAuditAppend(h.db, CODE, '99999999-9999-4999-8999-999999999999', {
      entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)],
    })
    expect(res._status).toBe(404)
  })

  it('読み出しも自分の店舗のぶんだけ', async () => {
    const h = setup()
    await handleAuditAppend(h.db, CODE,  SID,  { entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)] })
    await handleAuditAppend(h.db, OTHER, OSID, { entries: [entry('e2', 'レタス', '端末B', 'dev-b', 2000)] })
    expect((await handleAuditGet(h.db, CODE, SID)).map(e => e.id)).toEqual(['e1'])
    expect((await handleAuditGet(h.db, CODE, OSID))).toEqual([])
  })
})

describe('削除で記録も消える', () => {
  it('セッション削除で操作ログも消える', async () => {
    const h = setup()
    await handleAuditAppend(h.db, CODE, SID, { entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)] })
    await handleSessionDelete(h.db, CODE, SID)
    expect(auditRows(h)).toHaveLength(0)
  })

  it('履歴削除（sessionId 指定）で操作ログも消える', async () => {
    const h = setup()
    h.sqlite.prepare(`
      INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
      VALUES (?, ?, '2026-08-09', '{}', '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z', 1)
    `).run(CODE, SID)
    await handleAuditAppend(h.db, CODE, SID, { entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)] })

    await handleHistoryDelete(h.db, CODE, SID)
    expect(auditRows(h)).toHaveLength(0)
  })
})

describe('0017 未適用でも画面を壊さない', () => {
  it('table が無ければ読み出しは空を返す（例外を投げない）', async () => {
    const h = setup()
    h.sqlite.prepare('DROP TABLE session_audit').run()
    await expect(handleAuditGet(h.db, CODE, SID)).resolves.toEqual([])
  })

  it('table が無ければ追記は 503（retryable）で、棚卸自体は止めない', async () => {
    const h = setup()
    h.sqlite.prepare('DROP TABLE session_audit').run()
    const res = await handleAuditAppend(h.db, CODE, SID, {
      entries: [entry('e1', 'トマト', '端末A', 'dev-a', 1000)],
    })
    expect(res._status).toBe(503)
    expect(res.retryable).toBe(true)
  })
})
