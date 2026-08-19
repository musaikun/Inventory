// 再ログイン後の drain → pull 順序（DATA-001 / App第2セッション §6）
import { describe, it, expect, vi } from 'vitest'
import { resumeAfterLogin } from './authResume.js'

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

describe('resumeAfterLogin', () => {
  it('同じ店舗への再ログインでは drain → pull の順になる', async () => {
    const order = []
    await resumeAfterLogin({
      drain: async () => { order.push('drain'); return { drained: true, pending: 0 } },
      pull:  async () => { order.push('pull') },
    })
    expect(order).toEqual(['drain', 'pull'])
  })

  it('drain の完了前に pull しない', async () => {
    const gate = deferred()
    const pull = vi.fn(async () => {})
    const p = resumeAfterLogin({
      drain: async () => { await gate.promise; return { drained: true, pending: 0 } },
      pull,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(pull).not.toHaveBeenCalled()

    gate.resolve()
    await p
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('drain が送り切れなければ pull しない（stale remote で local を上書きしない）', async () => {
    const pull = vi.fn(async () => {})
    const onPendingLeft = vi.fn()
    const res = await resumeAfterLogin({
      drain: async () => ({ drained: false, pending: 2 }),
      pull, onPendingLeft,
    })
    expect(pull).not.toHaveBeenCalled()
    expect(res).toEqual({ pulled: false, pending: 2 })
    expect(onPendingLeft).toHaveBeenCalledWith(2)
  })

  it('drained を返さない実装では従来どおり pull する', async () => {
    const pull = vi.fn(async () => {})
    await resumeAfterLogin({ drain: async () => undefined, pull })
    expect(pull).toHaveBeenCalledTimes(1)
  })
})
