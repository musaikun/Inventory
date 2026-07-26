import { describe, it, expect } from 'vitest'
import { RoomDO } from './RoomDO.js'

// S-G: ゲスト端末に単価（原価）を渡さないことを検証する。
// config_update / joined / session_started の config.prices（および config_update の
// トップレベル prices）が、ゲスト宛の送信では空になる。

function makeState(wsList) {
  const store = new Map()
  return {
    storage: {
      async get(k) { return store.get(k) },
      async put(k, v) { store.set(k, v) },
      async setAlarm() {}, async getAlarm() { return null },
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
    serializeAttachment(a) { _att = a },
    send(d) { sent.push(JSON.parse(d)) },
    _sent: sent,
  }
}

describe('S-G: ゲストへ単価を渡さない', () => {
  it('_stripPricesForGuest はトップレベル prices と config.prices を空にする', () => {
    const room = new RoomDO(makeState([]), {})
    const a = room._stripPricesForGuest({ type: 'config_update', prices: { トマト: 100 }, order: ['トマト'] })
    expect(a.prices).toEqual({})
    const b = room._stripPricesForGuest({ type: 'session_started', config: { prices: { トマト: 100 }, order: ['トマト'] } })
    expect(b.config.prices).toEqual({})
    expect(b.config.order).toEqual(['トマト'])  // 単価以外は保持
  })

  it('_broadcastPriceAware: ホストは単価あり・ゲストは単価なし', () => {
    const host  = makeWs({ joined: true, deviceId: 'host', isHost: true })
    const guest = makeWs({ joined: true, deviceId: 'guest', isHost: false })
    const room  = new RoomDO(makeState([host, guest]), {})
    room._broadcastPriceAware({ type: 'config_update', prices: { トマト: 100 }, order: ['トマト'] })
    expect(host._sent[0].prices).toEqual({ トマト: 100 })
    expect(guest._sent[0].prices).toEqual({})
  })

  it('config メッセージ処理: ゲストへの config_update は prices が空', async () => {
    const host  = makeWs({ joined: true, deviceId: 'host', isHost: true })
    const guest = makeWs({ joined: true, deviceId: 'guest', isHost: false })
    const room  = new RoomDO(makeState([host, guest]), {})
    // ホストが単価つき config を送る（送信者=host は _broadcast の exclude 対象）
    await room._handleMessage(host, { type: 'config', order: ['トマト'], prices: { トマト: 100 } })
    const cu = guest._sent.find(m => m.type === 'config_update')
    expect(cu).toBeTruthy()
    expect(cu.prices).toEqual({})
    expect(cu.order).toEqual(['トマト'])
    // 保存側（DO storage）には単価は残る（ホストは後で受け取れる）
    expect(room.state._store.get('config').prices).toEqual({ トマト: 100 })
  })
})
