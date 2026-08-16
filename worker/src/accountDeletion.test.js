import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupExpiredAccountDeletionRecords,
  handleAccountDelete,
} from './accountDeletion.js'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

async function legacyPinHash(shopCode, pin) {
  const value = new TextEncoder().encode(`${shopCode}:${pin}`)
  const hash = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function createMockD1({ failBatchOnce = false } = {}) {
  const state = {
    stores: [],
    auth_tokens: [],
    login_attempts: [],
    store_configs: [],
    store_inventory: [],
    store_history: [],
    sessions: [],
    inventory_lines: [],
    item_par_levels: [],
    push_subscriptions: [],
    orders: [],
    order_lines: [],
    movements: [],
    movement_lines: [],
    import_batch_requests: [],   // 過去棚卸取込の要求台帳（migration 0015）
    account_deletion_receipts: [],
  }
  let shouldFailBatch = failBatchOnce

  const normalize = sql => sql.replace(/\s+/g, ' ').trim()
  const result = changes => ({ success: true, meta: { changes } })

  function first(sql, args) {
    const s = normalize(sql)
    if (s.startsWith('SELECT request_id, completed_at FROM account_deletion_receipts')) {
      const row = state.account_deletion_receipts.find(receipt =>
        receipt.request_id === args[0] && receipt.expires_at > args[1])
      return row ? { request_id: row.request_id, completed_at: row.completed_at } : null
    }
    if (s.includes('FROM auth_tokens t JOIN stores s')) {
      const token = state.auth_tokens.find(row =>
        row.token === args[0] && new Date(row.expires_at).getTime() > Date.now())
      if (!token) return null
      const store = state.stores.find(row => row.shop_code === token.shop_code)
      if (!store) return null
      return {
        shop_code: store.shop_code,
        pin_hash: store.pin_hash,
        deletion_pending_at: store.deletion_pending_at ?? null,
        deletion_request_id: store.deletion_request_id ?? null,
        deleted_at: store.deleted_at ?? null,
      }
    }
    if (s.startsWith('SELECT COUNT(*) AS n FROM login_attempts')) {
      const [shopCode, since] = args
      return {
        n: state.login_attempts.filter(row =>
          row.shop_code === shopCode && row.attempted_at > since).length,
      }
    }
    if (s.startsWith('SELECT deletion_pending_at, deletion_request_id, deleted_at FROM stores')) {
      const store = state.stores.find(row => row.shop_code === args[0])
      return store ? {
        deletion_pending_at: store.deletion_pending_at ?? null,
        deletion_request_id: store.deletion_request_id ?? null,
        deleted_at: store.deleted_at ?? null,
      } : null
    }
    throw new Error(`Unhandled first SQL: ${s}`)
  }

  function removeWhere(table, predicate) {
    let changes = 0
    for (let index = table.length - 1; index >= 0; index--) {
      if (predicate(table[index])) {
        table.splice(index, 1)
        changes++
      }
    }
    return result(changes)
  }

  function run(sql, args) {
    const s = normalize(sql)
    if (s.startsWith('INSERT INTO login_attempts')) {
      state.login_attempts.push({ shop_code: args[0], attempted_at: args[1] })
      return result(1)
    }
    if (s.startsWith('UPDATE stores SET deletion_pending_at')) {
      const [pendingAt, requestId, shopCode, sameRequestId] = args
      const store = state.stores.find(row => row.shop_code === shopCode)
      if (!store || store.deleted_at ||
          (store.deletion_pending_at && store.deletion_request_id !== sameRequestId)) {
        return result(0)
      }
      store.deletion_pending_at = pendingAt
      store.deletion_request_id = requestId
      return result(1)
    }
    const shopDelete = s.match(/^DELETE FROM (\w+) WHERE shop_code = \?$/)
    if (shopDelete) {
      return removeWhere(state[shopDelete[1]], row => row.shop_code === args[0])
    }
    if (s.startsWith('UPDATE stores SET store_name = NULL')) {
      const [createdAt, updatedAt, deletedAt, shopCode, requestId] = args
      const store = state.stores.find(row =>
        row.shop_code === shopCode && row.deletion_request_id === requestId && !row.deleted_at)
      if (!store) return result(0)
      Object.assign(store, {
        store_name: null,
        pin_hash: null,
        active_room: null,
        plan: 'free',
        created_at: createdAt,
        updated_at: updatedAt,
        deletion_pending_at: null,
        deletion_request_id: null,
        deleted_at: deletedAt,
      })
      return result(1)
    }
    if (s.startsWith('INSERT INTO account_deletion_receipts')) {
      const [requestId, completedAt, expiresAt, shopCode, expectedDeletedAt] = args
      if (shopCode) {
        const tombstone = state.stores.find(row =>
          row.shop_code === shopCode &&
          row.deleted_at === expectedDeletedAt &&
          row.pin_hash == null &&
          row.deletion_pending_at == null)
        if (!tombstone) return result(0)
      }
      if (state.account_deletion_receipts.some(row => row.request_id === requestId)) return result(0)
      state.account_deletion_receipts.push({ request_id: requestId, completed_at: completedAt, expires_at: expiresAt })
      return result(1)
    }
    if (s.startsWith('DELETE FROM account_deletion_receipts WHERE expires_at')) {
      return removeWhere(state.account_deletion_receipts, row => row.expires_at <= args[0])
    }
    if (s.startsWith('DELETE FROM stores WHERE deleted_at')) {
      return removeWhere(state.stores, row =>
        row.deleted_at != null && row.deleted_at <= args[0] && row.deletion_pending_at == null)
    }
    throw new Error(`Unhandled run SQL: ${s}`)
  }

  function prepare(sql) {
    let args = []
    const statement = {
      _sql: sql,
      _args: () => args,
      bind(...values) { args = values; return statement },
      async first() { return first(sql, args) },
      async run() { return run(sql, args) },
    }
    return statement
  }

  async function batch(statements) {
    const snapshot = structuredClone(state)
    try {
      const results = []
      for (let index = 0; index < statements.length; index++) {
        if (shouldFailBatch && index === 4) {
          shouldFailBatch = false
          throw new Error('injected D1 batch failure')
        }
        results.push(run(statements[index]._sql, statements[index]._args()))
      }
      return results
    } catch (error) {
      for (const key of Object.keys(state)) {
        state[key].splice(0, state[key].length, ...snapshot[key])
      }
      throw error
    }
  }

  return { prepare, batch, _state: state }
}

async function seedAccount(db, { shopCode = 'STOREA', pin = '1234', token = 'token-a' } = {}) {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  db._state.stores.push({
    shop_code: shopCode,
    store_name: `${shopCode}店`,
    pin_hash: await legacyPinHash(shopCode, pin),
    active_room: shopCode,
    plan: 'pro',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deletion_pending_at: null,
    deletion_request_id: null,
    deleted_at: null,
  })
  db._state.auth_tokens.push({ token, shop_code: shopCode, expires_at: future })
  db._state.login_attempts.push({ shop_code: shopCode, attempted_at: '2026-01-01T00:00:00.000Z' })
  for (const table of [
    'store_configs', 'store_inventory', 'store_history', 'sessions', 'inventory_lines',
    'item_par_levels', 'push_subscriptions', 'orders', 'order_lines', 'movements', 'movement_lines',
  ]) {
    db._state[table].push({ shop_code: shopCode, id: `${table}-${shopCode}` })
  }
  return { shopCode, token }
}

function requestWithToken(token) {
  return {
    headers: {
      get(name) {
        return name === 'Authorization' && token ? `Bearer ${token}` : null
      },
    },
  }
}

function validBody(overrides = {}) {
  return { requestId: REQUEST_ID, pin: '1234', confirmation: 'STOREA', ...overrides }
}

describe('PLAY-001: account deletion', () => {
  let db

  beforeEach(() => { db = createMockD1() })

  it('UUIDでないrequestIdは400で拒否し、DOもD1も変更しない', async () => {
    const account = await seedAccount(db)
    const purgeRooms = vi.fn()

    const response = await handleAccountDelete(
      db, requestWithToken(account.token), validBody({ requestId: 'not-a-uuid' }), purgeRooms)

    expect(response).toMatchObject({ _status: 400, code: 'invalid_request' })
    expect(purgeRooms).not.toHaveBeenCalled()
    expect(db._state.stores[0].deletion_pending_at).toBeNull()
  })

  it('無効tokenは401で拒否する', async () => {
    await seedAccount(db)
    const purgeRooms = vi.fn()

    const response = await handleAccountDelete(
      db, requestWithToken('other-token'), validBody(), purgeRooms)

    expect(response).toMatchObject({ _status: 401, code: 'reauthentication_failed' })
    expect(purgeRooms).not.toHaveBeenCalled()
  })

  it('現在PINが違う場合は401で記録し、削除を開始しない', async () => {
    const account = await seedAccount(db)
    const purgeRooms = vi.fn()
    const attemptsBefore = db._state.login_attempts.length

    const response = await handleAccountDelete(
      db, requestWithToken(account.token), validBody({ pin: '9999' }), purgeRooms)

    expect(response).toMatchObject({ _status: 401, code: 'reauthentication_failed' })
    expect(db._state.login_attempts).toHaveLength(attemptsBefore + 1)
    expect(db._state.stores[0].deletion_pending_at).toBeNull()
    expect(purgeRooms).not.toHaveBeenCalled()
  })

  it('PIN失敗が上限なら正しいPINでも429で削除を開始しない', async () => {
    const account = await seedAccount(db)
    const purgeRooms = vi.fn()
    const recent = new Date().toISOString()
    for (let index = 0; index < 5; index++) {
      db._state.login_attempts.push({ shop_code: account.shopCode, attempted_at: recent })
    }

    const response = await handleAccountDelete(
      db, requestWithToken(account.token), validBody(), purgeRooms)

    expect(response).toMatchObject({ _status: 429, code: 'too_many_attempts' })
    expect(db._state.stores[0].deletion_pending_at).toBeNull()
    expect(purgeRooms).not.toHaveBeenCalled()
  })

  it('別requestIdの削除がpendingなら409で処理を奪わない', async () => {
    const account = await seedAccount(db)
    db._state.stores[0].deletion_pending_at = new Date().toISOString()
    db._state.stores[0].deletion_request_id = '22222222-2222-4222-8222-222222222222'
    const purgeRooms = vi.fn()

    const response = await handleAccountDelete(
      db, requestWithToken(account.token), validBody(), purgeRooms)

    expect(response).toMatchObject({ _status: 409, code: 'deletion_in_progress', retryable: false })
    expect(db._state.stores[0].deletion_request_id).toBe('22222222-2222-4222-8222-222222222222')
    expect(purgeRooms).not.toHaveBeenCalled()
  })

  it('別店舗tokenと対象店舗codeの組み合わせでは他店舗を削除できない', async () => {
    const first = await seedAccount(db)
    const second = await seedAccount(db, { shopCode: 'STOREB', pin: '5678', token: 'token-b' })
    const purgeRooms = vi.fn()

    const response = await handleAccountDelete(db, requestWithToken(second.token), {
      requestId: REQUEST_ID,
      pin: '5678',
      confirmation: first.shopCode,
    }, purgeRooms)

    expect(response).toMatchObject({ _status: 400, code: 'confirmation_mismatch' })
    expect(db._state.stores.every(store => store.deleted_at == null)).toBe(true)
    expect(purgeRooms).not.toHaveBeenCalled()
  })

  it('正常時は関連dataと全tokenを削除し、7日tombstoneと匿名receiptだけを残す', async () => {
    const first = await seedAccount(db)
    await seedAccount(db, { shopCode: 'STOREB', pin: '5678', token: 'token-b' })
    db._state.auth_tokens.push({ token: 'second-token-a', shop_code: first.shopCode, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
    const purgeRooms = vi.fn().mockResolvedValue(undefined)

    const response = await handleAccountDelete(
      db, requestWithToken(first.token), validBody(), purgeRooms)

    expect(response).toMatchObject({ ok: true, status: 'deleted', requestId: REQUEST_ID, alreadyDeleted: false })
    expect(purgeRooms).toHaveBeenCalledOnce()
    expect(purgeRooms).toHaveBeenCalledWith(first.shopCode)
    for (const table of [
      'auth_tokens', 'login_attempts', 'store_configs', 'store_inventory', 'store_history',
      'sessions', 'inventory_lines', 'item_par_levels', 'push_subscriptions', 'orders',
      'order_lines', 'movements', 'movement_lines',
    ]) {
      expect(db._state[table].some(row => row.shop_code === first.shopCode), table).toBe(false)
      expect(db._state[table].some(row => row.shop_code === 'STOREB'), table).toBe(true)
    }
    const tombstone = db._state.stores.find(store => store.shop_code === first.shopCode)
    expect(tombstone).toMatchObject({
      store_name: null,
      pin_hash: null,
      active_room: null,
      plan: 'free',
      deletion_pending_at: null,
      deletion_request_id: null,
    })
    expect(tombstone.deleted_at).toBe(response.deletedAt)
    expect(db._state.account_deletion_receipts).toEqual([
      expect.objectContaining({ request_id: REQUEST_ID, completed_at: response.deletedAt }),
    ])
    expect(db._state.account_deletion_receipts[0]).not.toHaveProperty('shop_code')
  })

  it('同じrequestIdの再送はtoken失効後でも200の冪等成功を返す', async () => {
    const account = await seedAccount(db)
    const purgeRooms = vi.fn().mockResolvedValue(undefined)
    const first = await handleAccountDelete(db, requestWithToken(account.token), validBody(), purgeRooms)

    const replay = await handleAccountDelete(db, requestWithToken(null), validBody(), purgeRooms)

    expect(first._status).toBeUndefined()
    expect(replay).toMatchObject({
      ok: true,
      status: 'deleted',
      requestId: REQUEST_ID,
      deletedAt: first.deletedAt,
      alreadyDeleted: true,
    })
    expect(purgeRooms).toHaveBeenCalledOnce()
  })

  it('DO purge失敗は503とpending状態を残し、同じrequestIdで再試行できる', async () => {
    const account = await seedAccount(db)
    const purgeRooms = vi.fn()
      .mockRejectedValueOnce(new Error('DO unavailable'))
      .mockResolvedValueOnce(undefined)

    const failed = await handleAccountDelete(db, requestWithToken(account.token), validBody(), purgeRooms)
    expect(failed).toMatchObject({ _status: 503, code: 'deletion_temporarily_unavailable', retryable: true })
    expect(db._state.stores[0]).toMatchObject({
      deletion_request_id: REQUEST_ID,
      deleted_at: null,
    })
    expect(db._state.auth_tokens).toHaveLength(1)
    expect(db._state.store_configs).toHaveLength(1)

    const retried = await handleAccountDelete(db, requestWithToken(account.token), validBody(), purgeRooms)
    expect(retried).toMatchObject({ ok: true, status: 'deleted', alreadyDeleted: false })
    expect(purgeRooms).toHaveBeenCalledTimes(2)
  })

  it('D1 batch途中失敗はrollbackして503を返し、再試行で完了する', async () => {
    db = createMockD1({ failBatchOnce: true })
    const account = await seedAccount(db)
    const purgeRooms = vi.fn().mockResolvedValue(undefined)

    const failed = await handleAccountDelete(db, requestWithToken(account.token), validBody(), purgeRooms)
    expect(failed).toMatchObject({ _status: 503, code: 'deletion_temporarily_unavailable', retryable: true })
    expect(db._state.auth_tokens).toHaveLength(1)
    expect(db._state.store_configs).toHaveLength(1)
    expect(db._state.account_deletion_receipts).toHaveLength(0)

    const retried = await handleAccountDelete(db, requestWithToken(account.token), validBody(), purgeRooms)
    expect(retried).toMatchObject({ ok: true, status: 'deleted' })
  })

  it('期限切れreceiptとtombstoneだけを削除し、pendingと保持期間内は残す', async () => {
    const now = new Date('2026-07-25T12:00:00.000Z')
    db._state.account_deletion_receipts.push(
      { request_id: 'expired', completed_at: '2026-07-17T00:00:00.000Z', expires_at: '2026-07-24T00:00:00.000Z' },
      { request_id: 'fresh', completed_at: '2026-07-24T00:00:00.000Z', expires_at: '2026-07-31T00:00:00.000Z' },
    )
    db._state.stores.push(
      { shop_code: 'OLDDEL', deleted_at: '2026-07-17T00:00:00.000Z', deletion_pending_at: null },
      { shop_code: 'NEWDEL', deleted_at: '2026-07-24T00:00:00.000Z', deletion_pending_at: null },
      { shop_code: 'PENDING', deleted_at: null, deletion_pending_at: '2026-07-01T00:00:00.000Z' },
    )

    await cleanupExpiredAccountDeletionRecords(db, now)

    expect(db._state.account_deletion_receipts.map(row => row.request_id)).toEqual(['fresh'])
    expect(db._state.stores.map(row => row.shop_code)).toEqual(['NEWDEL', 'PENDING'])
  })
})
