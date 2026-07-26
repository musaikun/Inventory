import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import webpush from 'web-push'
import { deletePushSubscription, handleCron, savePushSubscription } from '../src/pushHandler.js'

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}))

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url))

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function validSubscription(endpoint = 'https://push.example.com/subscription/abc') {
  const publicKey = new Uint8Array(65).fill(1)
  publicKey[0] = 0x04
  return {
    endpoint,
    keys: {
      p256dh: base64Url(publicKey),
      auth: base64Url(new Uint8Array(16).fill(2)),
    },
  }
}

function createD1FromCurrentSchema() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }

  function prepare(sql) {
    let values = []
    const statement = {
      bind(...nextValues) {
        values = nextValues
        return statement
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) }
      },
      async run() {
        const result = sqlite.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
    return statement
  }

  return {
    sqlite,
    db: {
      prepare,
      async batch(statements) {
        const results = []
        sqlite.exec('BEGIN')
        try {
          for (const statement of statements) results.push(await statement.run())
          sqlite.exec('COMMIT')
          return results
        } catch (error) {
          sqlite.exec('ROLLBACK')
          throw error
        }
      },
    },
  }
}

describe('handleCron', () => {
  let sqlite

  afterEach(() => {
    sqlite?.close()
    sqlite = undefined
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('現在の全migrationを適用したschemaでcron全体を実行できる', async () => {
    const current = createD1FromCurrentSchema()
    sqlite = current.sqlite

    await expect(handleCron({
      DB: current.db,
      // stale-session queryまで通す。private keyが無いため通知送信は行われない。
      VAPID_PUBLIC_KEY: 'test-public-key',
    })).resolves.toBeUndefined()
  })

  it('active sessionは開始から24時間超・7日以内だけ再開通知する', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T03:00:00.000Z'))
    const current = createD1FromCurrentSchema()
    sqlite = current.sqlite
    sqlite.exec(`
      INSERT INTO stores (shop_code, created_at, updated_at)
      VALUES ('ABCDEF', '2026-07-25T03:00:00.000Z', '2026-07-25T03:00:00.000Z');
      INSERT INTO push_subscriptions (shop_code, endpoint, p256dh, auth)
      VALUES ('ABCDEF', 'https://push.example/sub', 'p256dh', 'auth');
      INSERT INTO sessions (id, shop_code, started_at, status, item_count)
      VALUES
        ('stale', 'ABCDEF', datetime('now', '-25 hours'), 'active', 0),
        ('fresh', 'ABCDEF', datetime('now', '-23 hours'), 'active', 0),
        ('too-old', 'ABCDEF', datetime('now', '-8 days'), 'active', 0);
    `)

    await handleCron({
      DB: current.db,
      VAPID_PUBLIC_KEY: 'test-public-key',
      VAPID_PRIVATE_KEY: 'test-private-key',
    })

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1])
    expect(payload.tag).toBe('stale-session')
  })
})

describe('push subscription persistence', () => {
  let sqlite

  afterEach(() => sqlite?.close())

  it('無効なURL・鍵をDBへ保存しない', async () => {
    const current = createD1FromCurrentSchema()
    sqlite = current.sqlite
    sqlite.exec(`INSERT INTO stores (shop_code) VALUES ('AAAAAA')`)
    const result = await savePushSubscription(current.db, 'AAAAAA', {
      endpoint: 'http://localhost/push',
      keys: { p256dh: 'invalid', auth: '' },
    })

    expect(result._status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n).toBe(0)
  })

  it('別店舗は既存endpointを奪取・削除できない', async () => {
    const current = createD1FromCurrentSchema()
    sqlite = current.sqlite
    sqlite.exec(`INSERT INTO stores (shop_code) VALUES ('AAAAAA'), ('BBBBBB')`)
    const subscription = validSubscription()

    expect(await savePushSubscription(current.db, 'AAAAAA', subscription)).toEqual({ ok: true })
    const conflict = await savePushSubscription(current.db, 'BBBBBB', subscription)
    expect(conflict._status).toBe(409)
    const afterConflict = sqlite.prepare(
      'SELECT shop_code FROM push_subscriptions WHERE endpoint = ?'
    ).get(subscription.endpoint)
    expect(afterConflict.shop_code).toBe('AAAAAA')

    expect(await deletePushSubscription(current.db, 'BBBBBB', subscription.endpoint)).toEqual({ ok: true })
    const afterDelete = sqlite.prepare(
      'SELECT shop_code FROM push_subscriptions WHERE endpoint = ?'
    ).get(subscription.endpoint)
    expect(afterDelete.shop_code).toBe('AAAAAA')
  })
})
