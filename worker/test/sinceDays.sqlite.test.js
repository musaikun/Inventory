/**
 * GET の `?sinceDays=` を付けないときは既定の日数（発注・入出庫は400日、やることは120日）。
 *
 * `Number(null)` が 0 になり「指定なし」が「1日」へ丸められていたため、App（sinceDays を付けずに呼ぶ）には
 * 直近1日ぶんしか返らず、別の端末では前日より前の入出庫・発注・完了したやることがサーバーから取れなかった。
 * テストの日付が今日に近いと気づけないので、日付は「今日から30日前」で作る。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'

const CODE = 'SHOPAA'
const daysAgo = n => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10)

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  const token = h.seedToken(CODE)
  const env = { DB: h.db, ALLOWED_ORIGIN: 'https://inventory-app.pages.dev' }
  const call = (path, method = 'GET', body) => worker.fetch(new Request(`https://worker.example/store/${CODE}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), env)
  return { call }
}

describe('sinceDays の既定', () => {
  it('入出庫: 指定なしは30日前も返し、sinceDays=1 なら返さない', async () => {
    const { call } = setup()
    expect((await call('/movements', 'POST', { type: 'in', date: daysAgo(30), lines: [{ item: 'トマト', qty: 1, unit: '個' }] })).status).toBe(200)
    expect(await (await call('/movements')).json()).toHaveLength(1)
    expect(await (await call('/movements?sinceDays=1')).json()).toHaveLength(0)
    expect(await (await call('/movements?sinceDays=abc')).json()).toHaveLength(1)   // 数でなければ既定
  })

  it('発注: 指定なしは30日前も返す', async () => {
    const { call } = setup()
    const res = await call('/orders', 'POST', { id: 'o_1', date: daysAgo(30), lines: [{ item: 'トマト', qty: 2, unit: '個' }] })
    expect(res.status).toBe(200)
    expect(await (await call('/orders')).json()).toHaveLength(1)
    expect(await (await call('/orders?sinceDays=1')).json()).toHaveLength(0)
  })

  it('やること: 指定なしは30日前に完了したものも返す', async () => {
    const { call } = setup()
    const t = { id: 't_' + 'b'.repeat(16), date: daysAgo(30), text: '掃除', updatedAt: new Date().toISOString(), doneAt: new Date().toISOString() }
    expect((await call('/tasks', 'POST', t)).status).toBe(200)
    expect(await (await call('/tasks')).json()).toHaveLength(1)
    expect(await (await call('/tasks?sinceDays=1')).json()).toHaveLength(0)
  })
})
