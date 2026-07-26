import { describe, it, expect } from 'vitest'
import { RoomDO } from './RoomDO.js'

// R2-04: 発注数チャネル（order_update / order_remove）の DO 側の挙動を検証する。
// storage・WebSocket を最小モックし、_handleMessage を直接駆動する。

function makeState(wsList) {
  const store = new Map()
  return {
    storage: {
      async get(k)  { return store.get(k) },
      async put(k, v) { store.set(k, v) },
      async setAlarm() {},
      async getAlarm() { return null },
    },
    getWebSockets() { return wsList },
    _store: store,
  }
}

function makeWs(att) {
  const sent = []
  let _att = { ...att }
  return {
    deserializeAttachment() { return _att },
    serializeAttachment(a) { _att = a },   // レート制限カウンタの書き戻し用
    send(d) { sent.push(JSON.parse(d)) },
    _sent: sent,
  }
}

function setup() {
  const ws1 = makeWs({ joined: true, deviceId: 'd1', deviceName: 'レジ' })
  const ws2 = makeWs({ joined: true, deviceId: 'd2', deviceName: 'ホール' })
  const state = makeState([ws1, ws2])
  const room = new RoomDO(state, {})
  return { room, state, ws1, ws2 }
}

describe('RoomDO 発注数チャネル（order_update / order_remove）', () => {
  it('order_update: orders に保存し、audit(order_set)を記録、送信者以外へ配信', async () => {
    const { room, state, ws1, ws2 } = setup()
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'トマト', orderQty: 5, unit: '箱', lot: 2, enteredBy: 'レジ' })

    const orders = state._store.get('orders')
    expect(orders['トマト']).toMatchObject({ orderQty: 5, unit: '箱', lot: 2, enteredBy: 'レジ', enteredById: 'd1' })
    expect(typeof orders['トマト'].updatedAt).toBe('number')

    const audit = state._store.get('auditLog')
    expect(audit.at(-1)).toMatchObject({ ingredient: 'トマト', action: 'order_set', totalQty: 5 })

    // 送信者(ws1)は order_update を受け取らない（audit_entry は受け取る）
    expect(ws1._sent.some(m => m.type === 'order_update')).toBe(false)
    expect(ws1._sent.some(m => m.type === 'audit_entry')).toBe(true)
    // 他端末(ws2)は order_update を受け取る
    const ou = ws2._sent.find(m => m.type === 'order_update')
    expect(ou).toMatchObject({ ingredient: 'トマト', orderQty: 5, unit: '箱', lot: 2, fromDeviceId: 'd1' })
  })

  it('order_update: orderQty が数値でない/0以下は保存しない（防御）', async () => {
    const { room, state, ws1 } = setup()
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'トマト', orderQty: 'x' })
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'レタス', orderQty: 0 })
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'ナス', orderQty: -3 })
    expect(state._store.get('orders')).toBeUndefined()
  })

  it('order_update: Infinity・上限超えの orderQty は保存しない（R2-05・有限/上限ガード）', async () => {
    const { room, state, ws1 } = setup()
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'トマト', orderQty: Infinity })
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'レタス', orderQty: 1e12 })
    expect(state._store.get('orders')).toBeUndefined()
    // 上限ちょうどは通る
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'ナス', orderQty: 1000000 })
    expect(state._store.get('orders')['ナス'].orderQty).toBe(1000000)
  })

  it('order_update: lot 不正は 1、enteredBy 未指定は deviceName を採用', async () => {
    const { room, state, ws1 } = setup()
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'トマト', orderQty: 2, lot: 0 })
    const o = state._store.get('orders')['トマト']
    expect(o.lot).toBe(1)
    expect(o.enteredBy).toBe('レジ')  // att.deviceName フォールバック
  })

  it('order_remove: 既存の発注数を削除し、audit(order_clear)＋配信', async () => {
    const { room, state, ws1, ws2 } = setup()
    await room._handleMessage(ws1, { type: 'order_update', ingredient: 'トマト', orderQty: 4, unit: '箱' })
    ws2._sent.length = 0
    await room._handleMessage(ws1, { type: 'order_remove', ingredient: 'トマト' })

    expect(state._store.get('orders')['トマト']).toBeUndefined()
    expect(state._store.get('auditLog').at(-1)).toMatchObject({ ingredient: 'トマト', action: 'order_clear' })
    expect(ws2._sent.find(m => m.type === 'order_remove')).toMatchObject({ ingredient: 'トマト', fromDeviceId: 'd1' })
  })

  it('order_remove: 存在しない品目は audit を残さず配信のみ', async () => {
    const { room, state, ws1, ws2 } = setup()
    await room._handleMessage(ws1, { type: 'order_remove', ingredient: '無い品' })
    expect(state._store.get('auditLog')).toBeUndefined()
    expect(ws2._sent.find(m => m.type === 'order_remove')).toMatchObject({ ingredient: '無い品' })
  })
})
