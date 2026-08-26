// 変更履歴（監査ログ）のチャンク保存。
//
// 変更履歴は参加者別の重複カウントと品目ごとの履歴の正本なので、品目数を大きく上回る
// 件数（1品目を複数人が直す）を保持する必要がある。
// DO storage は1つの値が 128KiB 上限で、全件を1キー（旧 `auditLog`）へ書くと
// 500件前後で put が落ちて同期そのものが壊れる。AUDIT_CHUNK_SIZE 件ずつ別キーへ分け、
// 追記は末尾チャンクだけを読み書きする。
import { describe, it, expect } from 'vitest'
import { RoomDO } from './RoomDO.js'
import { makeState } from '../test/doState.js'
import { AUDIT_CHUNK_SIZE, MAX_AUDIT_LOG } from './constants.js'

function makeWs(att) {
  const sent = []
  let _att = { ...att }
  return {
    deserializeAttachment() { return _att },
    serializeAttachment(a) { _att = a },
    send(d) { sent.push(JSON.parse(d)) },
    close(code, reason) { sent.push({ type: '_closed', code, reason }) },
    _sent: sent,
  }
}

function setup(initial = {}) {
  const ws1 = makeWs({ joined: true, deviceId: 'dev-1', deviceName: '端末A', isHost: true })
  // ゲスト参加はセッションが active でないと弾かれる
  const state = makeState([ws1], { isActive: true, ...initial })
  return { room: new RoomDO(state, {}), state, ws1 }
}

const chunkKeys = (state) => [...state._store.keys()].filter(k => k.startsWith('audit:')).sort()

// WS のレート制限（2秒で20件）に当たると更新が黙って捨てられるので、
// 大量投入するテストでは毎回カウンタを戻す。ここで見たいのは保存の仕方であって
// レート制限ではない。
async function update(room, ws, item, qty, by = '端末A') {
  const att = ws.deserializeAttachment() ?? {}
  ws.serializeAttachment({ ...att, _rlTime: 0, _rlCount: 0 })
  await room._handleMessage(ws, {
    type: 'update', ingredient: item, qty, unit: '個', enteredBy: by,
  })
}

describe('監査ログのチャンク保存', () => {
  it('追記は末尾チャンクにだけ積み、上限で新しいキーへ移る', async () => {
    const { room, state, ws1 } = setup()
    for (let i = 0; i < AUDIT_CHUNK_SIZE + 5; i++) await update(room, ws1, `品目${i}`, i + 1)

    const keys = chunkKeys(state)
    expect(keys).toEqual(['audit:000000', 'audit:000001'])
    expect(state._store.get('audit:000000')).toHaveLength(AUDIT_CHUNK_SIZE)
    expect(state._store.get('audit:000001')).toHaveLength(5)
    // 旧形式の1キーには書かない
    expect(state._store.get('auditLog')).toBeUndefined()
  })

  it('joined は全チャンクを時系列順に連結して返す', async () => {
    const { room, state, ws1 } = setup()
    for (let i = 0; i < AUDIT_CHUNK_SIZE + 3; i++) await update(room, ws1, `品目${i}`, i + 1)

    const guest = makeWs({ joined: false, deviceId: 'dev-2', deviceName: '端末B' })
    state.getWebSockets = () => [ws1, guest]
    await room._handleMessage(guest, { type: 'join', deviceId: 'dev-2', deviceName: '端末B', role: 'guest' })

    const joined = guest._sent.find(m => m.type === 'joined')
    expect(joined.auditLog).toHaveLength(AUDIT_CHUNK_SIZE + 3)
    expect(joined.auditLog[0].ingredient).toBe('品目0')
    expect(joined.auditLog.at(-1).ingredient).toBe(`品目${AUDIT_CHUNK_SIZE + 2}`)
  })

  it('同じ品目を複数人が直しても、件数ぶんすべて残る', async () => {
    const { room, state, ws1 } = setup()
    const ws2 = makeWs({ joined: true, deviceId: 'dev-2', deviceName: '端末B', isHost: false })
    state.getWebSockets = () => [ws1, ws2]

    await update(room, ws1, 'トマト', 3)
    await update(room, ws2, 'トマト', 5, '端末B')
    await update(room, ws1, 'トマト', 8)

    const log = await room._readAudit()
    expect(log).toHaveLength(3)
    expect(log.map(e => e.enteredBy)).toEqual(['端末A', '端末B', '端末A'])
    expect(log.map(e => e.totalQty)).toEqual([3, 5, 8])
  })

  it('旧形式（1キーに全件）が残っていても読めて、追記時にチャンクへ移す', async () => {
    const legacy = Array.from({ length: 150 }, (_, i) => ({
      id: `old-${i}`, ingredient: `旧${i}`, action: 'new', totalQty: 1,
      unit: '個', enteredBy: '端末A', enteredById: 'dev-1', timestamp: 1_000 + i,
    }))
    const { room, state, ws1 } = setup({ auditLog: legacy })

    // 移行前でも読める
    expect(await room._readAudit()).toHaveLength(150)

    await update(room, ws1, '新しい品目', 1)

    expect(state._store.get('auditLog')).toBeUndefined()
    expect(chunkKeys(state)).toEqual(['audit:000000', 'audit:000001'])
    const log = await room._readAudit()
    expect(log).toHaveLength(151)
    expect(log[0].id).toBe('old-0')
    expect(log.at(-1).ingredient).toBe('新しい品目')
  })

  it('上限を超えたら古いチャンクごと捨てる', async () => {
    const maxChunks = Math.ceil(MAX_AUDIT_LOG / AUDIT_CHUNK_SIZE)
    // 上限ぶんのチャンクを直接置いてから1件足す
    const initial = {}
    for (let i = 0; i < maxChunks; i++) {
      initial[`audit:${String(i).padStart(6, '0')}`] =
        Array.from({ length: AUDIT_CHUNK_SIZE }, (_, j) => ({ id: `c${i}-${j}`, timestamp: i * 1000 + j }))
    }
    const { room, state, ws1 } = setup(initial)
    for (let i = 0; i < AUDIT_CHUNK_SIZE; i++) await update(room, ws1, `品目${i}`, 1)

    const keys = chunkKeys(state)
    expect(keys.length).toBeLessThanOrEqual(maxChunks)
    // 捨てられるのは古い方
    expect(keys).not.toContain('audit:000000')
  })

  it('新しいセッションの開始で全チャンクを消す（前回の履歴を混ぜない）', async () => {
    const { room, state, ws1 } = setup({ sessionId: 'old-session', auditLog: [{ id: 'legacy', timestamp: 1 }] })
    for (let i = 0; i < AUDIT_CHUNK_SIZE + 2; i++) await update(room, ws1, `品目${i}`, 1)
    expect(chunkKeys(state).length).toBeGreaterThan(1)

    await room._handleMessage(ws1, {
      type: 'session_start', sessionId: 'new-session', inventory: {},
    })

    expect(chunkKeys(state)).toEqual([])
    expect(state._store.get('auditLog')).toBeUndefined()
    expect(await room._readAudit()).toEqual([])
  })

  it('同じセッションの再開ではチャンクを消さない', async () => {
    const { room, state, ws1 } = setup({ sessionId: 'sess-1' })
    await update(room, ws1, 'トマト', 3)
    await room._handleMessage(ws1, { type: 'session_start', sessionId: 'sess-1', inventory: {} })
    expect(await room._readAudit()).toHaveLength(1)
  })
})
