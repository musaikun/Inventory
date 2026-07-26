import { describe, it, expect } from 'vitest'
import { RoomDO } from './RoomDO.js'

function makeState(wsList = [], initial = {}) {
  const store = new Map(Object.entries(initial))
  let alarmDeleted = false
  return {
    storage: {
      async get(key) { return store.get(key) },
      async put(key, value) { store.set(key, value) },
      async setAlarm() {},
      async getAlarm() { return null },
      async deleteAlarm() { alarmDeleted = true },
      async deleteAll() { store.clear() },
    },
    getWebSockets() { return wsList },
    _store: store,
    _alarmDeleted() { return alarmDeleted },
  }
}

function makeWs(attachment = null) {
  const sent = []
  const closed = []
  let currentAttachment = attachment == null ? null : { ...attachment }
  return {
    deserializeAttachment() { return currentAttachment },
    serializeAttachment(value) { currentAttachment = value },
    send(data) { sent.push(JSON.parse(data)) },
    close(code, reason) { closed.push({ code, reason }) },
    _attachment() { return currentAttachment },
    _sent: sent,
    _closed: closed,
  }
}

function makeProtectedDb({ shopCode = 'SHOP01', validAuthToken = 'valid-auth' } = {}) {
  return {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async first() {
              if (query.includes('SELECT pin_hash FROM stores')) {
                return { pin_hash: 'stored-pin-hash' }
              }
              if (query.includes('FROM auth_tokens')) {
                return values[0] === validAuthToken ? { shop_code: shopCode } : null
              }
              return null
            },
          }
        },
      }
    },
  }
}

const JOIN_REQUIRED_TYPES = [
  'config',
  'update',
  'remove',
  'order_update',
  'order_remove',
  'recount_flag',
  'leave',
  'done',
  'undone',
  'message',
  'message_delete',
  'dissolve',
  'rename',
  'session_start',
  'session_end',
  'typing',
  'conflict_notify',
  'conflict_lock',
  'item_add_request',
  'item_add_response',
  'unknown',
]

describe('SEC-001: WebSocket join 認可境界', () => {
  it.each(JOIN_REQUIRED_TYPES)('未参加ソケットの %s を拒否する', async (type) => {
    const ws = makeWs()
    const room = new RoomDO(makeState([ws]), {})

    await room._handleMessage(ws, { type })

    expect(ws._sent).toEqual([{ type: 'error', code: 'join_required' }])
    expect(ws._closed).toEqual([{ code: 1008, reason: 'Join required' }])
  })

  it('未参加でも ping は許可する', async () => {
    const ws = makeWs()
    const room = new RoomDO(makeState([ws]), {})

    await room._handleMessage(ws, { type: 'ping' })

    expect(ws._sent).toEqual([{ type: 'pong' }])
    expect(ws._closed).toEqual([])
  })

  it.each(['', '   '])('空の deviceId (%j) では join できない', async (deviceId) => {
    const ws = makeWs()
    const room = new RoomDO(makeState([ws], { isActive: true }), {})

    await room._handleMessage(ws, {
      type: 'join',
      role: 'guest',
      deviceId,
      deviceName: 'ゲスト',
    })

    expect(ws._sent).toEqual([{ type: 'error', code: 'invalid_device_id' }])
    expect(ws._closed).toEqual([{ code: 1008, reason: 'Invalid device ID' }])
    expect(ws._attachment()).toBeNull()
  })

  it('join 成功時の認可状態を attachment に永続化する', async () => {
    const ws = makeWs()
    const state = makeState([ws], { isActive: true })
    const room = new RoomDO(state, {})

    await room._handleMessage(ws, {
      type: 'join',
      role: 'guest',
      deviceId: ' device-1 ',
      deviceName: 'ゲスト',
    })

    expect(ws._attachment()).toMatchObject({
      joined: true,
      deviceId: 'device-1',
      deviceName: 'ゲスト',
      isHost: false,
    })
    expect(ws._sent[0]).toMatchObject({ type: 'joined' })
    expect(ws._closed).toEqual([])
  })

  it('同じソケットからの二重 join を拒否し、既存セッションは維持する', async () => {
    const attachment = {
      joined: true,
      deviceId: 'device-1',
      deviceName: 'ゲスト',
      isHost: false,
    }
    const ws = makeWs(attachment)
    const room = new RoomDO(makeState([ws], { isActive: true }), {})

    await room._handleMessage(ws, {
      type: 'join',
      role: 'guest',
      deviceId: 'device-1',
      deviceName: 'ゲスト',
    })

    expect(ws._sent).toEqual([{ type: 'error', code: 'already_joined' }])
    expect(ws._closed).toEqual([])
    expect(ws._attachment()).toEqual(attachment)
  })

  it('招待 session が一致しないゲストを拒否する', async () => {
    const ws = makeWs()
    const room = new RoomDO(makeState([ws], {
      isActive: true,
      sessionId: 'current-session',
    }), {})

    await room._handleMessage(ws, {
      type: 'join',
      role: 'guest',
      deviceId: 'guest-1',
      deviceName: 'ゲスト',
      joinSessionId: 'old-session',
    })

    expect(ws._sent).toEqual([{ type: 'error', code: 'invalid_link' }])
    expect(ws._closed).toEqual([{ code: 1008, reason: 'Invalid invite link' }])
    expect(ws._attachment()).toBeNull()
  })

  it('host 以外の role はゲストとして扱い、ホスト権限を付与しない', async () => {
    const ws = makeWs()
    const room = new RoomDO(makeState([ws], {
      isActive: true,
      sessionId: 'current-session',
    }), {})

    await room._handleMessage(ws, {
      type: 'join',
      role: 'owner',
      deviceId: 'guest-1',
      deviceName: 'ゲスト',
      joinSessionId: 'current-session',
    })

    expect(ws._attachment()).toMatchObject({ joined: true, isHost: false })
    expect(ws._sent[0]).toMatchObject({ type: 'joined' })
  })

  it('保護店舗では偽 host token と無効 auth token を拒否する', async () => {
    const ws = makeWs()
    const state = makeState([ws], {
      hostToken: 'real-host-token',
      shopCode: 'SHOP01',
    })
    const room = new RoomDO(state, { DB: makeProtectedDb() })

    await room._handleMessage(ws, {
      type: 'join',
      role: 'host',
      deviceId: 'attacker',
      deviceName: '攻撃者',
      hostToken: 'fake-host-token',
      authToken: 'invalid-auth',
    })

    expect(ws._sent).toEqual([{ type: 'error', code: 'auth_failed' }])
    expect(ws._closed).toEqual([{ code: 1008, reason: 'Host authentication failed' }])
    expect(ws._attachment()).toBeNull()
    expect(state._store.get('hostToken')).toBe('real-host-token')
  })

  it('正しい host token で同一端末が再接続し、旧ソケットを無効化する', async () => {
    const oldWs = makeWs({
      joined: true,
      deviceId: 'host-device',
      deviceName: 'ホスト',
      isHost: true,
    })
    const newWs = makeWs()
    const state = makeState([oldWs, newWs], { hostToken: 'real-host-token' })
    const room = new RoomDO(state, {})

    await room._handleMessage(newWs, {
      type: 'join',
      role: 'host',
      deviceId: 'host-device',
      deviceName: 'ホスト',
      hostToken: 'real-host-token',
    })

    expect(newWs._attachment()).toMatchObject({
      joined: true,
      deviceId: 'host-device',
      isHost: true,
    })
    expect(newWs._sent[0]).toMatchObject({ type: 'joined' })
    expect(oldWs._attachment()).toEqual({ leftCleanly: true })
    expect(oldWs._closed).toEqual([{ code: 1000, reason: 'Session recovered' }])
  })

  it('未参加ソケットへルーム内メッセージを配信しない', () => {
    const joined = makeWs({ joined: true, deviceId: 'device-1', isHost: false })
    const unjoined = makeWs()
    const room = new RoomDO(makeState([joined, unjoined]), {})

    room._broadcast({ type: 'message', text: 'secret' })
    room._broadcastPriceAware({ type: 'config_update', prices: { A: 100 } })

    expect(joined._sent.map(message => message.type)).toEqual(['message', 'config_update'])
    expect(unjoined._sent).toEqual([])
  })

  it('conflict_lock は参加済みホストだけが配信できる', async () => {
    const host = makeWs({ joined: true, deviceId: 'host', isHost: true })
    const guest = makeWs({ joined: true, deviceId: 'guest', isHost: false })
    const room = new RoomDO(makeState([host, guest]), {})

    await room._handleMessage(guest, { type: 'conflict_lock', ingredients: ['A'] })
    expect(host._sent).toEqual([])

    await room._handleMessage(host, { type: 'conflict_lock', ingredients: ['A'] })
    expect(guest._sent).toContainEqual({ type: 'conflict_lock', ingredients: ['A'] })
  })

  it('leave で認可状態を即時無効化する', async () => {
    const ws = makeWs({
      joined: true,
      deviceId: 'device-1',
      deviceName: 'ゲスト',
      isHost: false,
    })
    const room = new RoomDO(makeState([ws]), {})

    await room._handleMessage(ws, { type: 'leave' })
    expect(ws._attachment()).toEqual({ leftCleanly: true })

    await room._handleMessage(ws, { type: 'update', ingredient: 'A', qty: 1 })
    expect(ws._sent).toContainEqual({ type: 'error', code: 'join_required' })
    expect(ws._closed).toContainEqual({ code: 1008, reason: 'Join required' })
  })

  it('account deletion内部pathは専用headerが無ければ拒否する', async () => {
    const state = makeState([], { inventory: { A: { qty: 1 } } })
    const room = new RoomDO(state, {})

    const response = await room.fetch(new Request('https://internal/internal/account-delete', {
      method: 'DELETE',
    }))

    expect(response.status).toBe(403)
    expect(state._store.has('inventory')).toBe(true)
  })

  it('account deletion内部操作は全接続を閉じてDO storageを消去する', async () => {
    const host = makeWs({ joined: true, deviceId: 'host', isHost: true })
    const guest = makeWs({ joined: true, deviceId: 'guest', isHost: false })
    const state = makeState([host, guest], {
      inventory: { A: { qty: 1 } },
      hostToken: 'host-token',
    })
    const room = new RoomDO(state, {})
    room._itemAddRequests.set('request-1', guest)

    const response = await room.fetch(new Request('https://internal/internal/account-delete', {
      method: 'DELETE',
      headers: { 'X-Inventory-Internal-Action': 'account-delete-v1' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(state._store.size).toBe(0)
    expect(state._alarmDeleted()).toBe(true)
    expect(room._itemAddRequests.size).toBe(0)
    expect(host._sent).toContainEqual({ type: 'account_deleted' })
    expect(guest._sent).toContainEqual({ type: 'account_deleted' })
    expect(host._closed).toContainEqual({ code: 1000, reason: 'Account deleted' })
    expect(guest._closed).toContainEqual({ code: 1000, reason: 'Account deleted' })
  })
})
