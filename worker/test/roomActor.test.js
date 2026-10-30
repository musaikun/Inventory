// 変更履歴の「誰が」は端末ではなく人で残す（2026-10-30 実使用）。
// ログインしている人は actorId（オーナーは 'owner'）。ログインしていないゲストは、
// 同じセッションで同じ名前なら最初の端末 ID を使い回す（QR を読み直すと別のブラウザで開かれるため）。
import { describe, expect, it } from 'vitest'
import { RoomDO } from '../src/RoomDO.js'
import { makeState } from './doState.js'

function makeWs() {
  const sent = []
  let att = null
  return {
    deserializeAttachment() { return att },
    serializeAttachment(v) { att = v },
    send(d) { sent.push(JSON.parse(d)) },
    close() {},
    _sent: sent,
  }
}

function setup() {
  const sockets = []
  const state = makeState(sockets, { isActive: true, sessionId: 's-1' })
  const room = new RoomDO(state, {})
  async function join(deviceId, deviceName, actorId = deviceId) {
    const ws = makeWs()
    sockets.push(ws)
    await room._handleMessage(ws, { type: 'join', role: 'guest', deviceId, deviceName, actorId, joinSessionId: 's-1' })
    return ws
  }
  function leave(ws) { sockets.splice(sockets.indexOf(ws), 1) }
  async function update(ws, ingredient, qty) {
    await room._handleMessage(ws, { type: 'update', ingredient, qty, unit: '個', enteredBy: '' })
    return ws._sent.filter(m => m.type === 'audit_entry').at(-1)?.entry
  }
  return { join, leave, update, room, sockets }
}

describe('履歴の ID', () => {
  it('ゲストが別のブラウザで入り直しても、同じ名前なら同じ人として残る', async () => {
    const { join, leave, update } = setup()
    const a = await join('dev-a', '田中')
    expect(a._sent[0].actorId).toBe('dev-a')
    expect((await update(a, 'トマト', 1)).enteredById).toBe('dev-a')
    leave(a)

    const b = await join('dev-b', '田中')
    expect(b._sent[0].actorId).toBe('dev-a')
    expect((await update(b, 'なす', 2)).enteredById).toBe('dev-a')
  })

  it('名前が違えば別の人', async () => {
    const { join, update } = setup()
    await join('dev-a', '田中')
    const b = await join('dev-b', '鈴木')
    expect((await update(b, 'なす', 2)).enteredById).toBe('dev-b')
  })

  it('ログインしている人は端末に関係なくその人の ID', async () => {
    const { join, update } = setup()
    const a = await join('dev-a', 'オーナー', 'owner')
    expect((await update(a, 'トマト', 1)).enteredById).toBe('owner')
    expect(a._sent[0].participants?.find(p => p.deviceId === 'dev-a')?.actorId).toBe('owner')
  })

  it('新しいセッションでは名前の対応を持ち越さない', async () => {
    const { join, leave, room, sockets } = setup()
    const a = await join('dev-a', '田中')
    leave(a)
    const host = makeWs()
    host.serializeAttachment({ joined: true, deviceId: 'h', deviceName: 'ホスト', isHost: true })
    sockets.push(host)
    await room._handleMessage(host, { type: 'session_start', sessionId: 's-2', inventory: {} })
    const b = makeWs()
    sockets.push(b)
    await room._handleMessage(b, { type: 'join', role: 'guest', deviceId: 'dev-b', deviceName: '田中', actorId: 'dev-b', joinSessionId: 's-2' })
    expect(b._sent[0].actorId).toBe('dev-b')
  })
})
