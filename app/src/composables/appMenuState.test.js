import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('削除モーダルの Back handler 登録', () => {
  beforeEach(() => { vi.resetModules() })

  it('handler が無ければ Back を消費しない', async () => {
    const { consumeDeleteAccountBack } = await import('./appMenuState.js')

    expect(consumeDeleteAccountBack()).toBe(false)
  })

  it('登録中は Back を消費して handler を1回呼び、解除後は消費しない', async () => {
    const {
      registerDeleteAccountBackHandler,
      consumeDeleteAccountBack,
    } = await import('./appMenuState.js')
    const handler = vi.fn()
    const unregister = registerDeleteAccountBackHandler(handler)

    expect(consumeDeleteAccountBack()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    unregister()
    expect(consumeDeleteAccountBack()).toBe(false)
  })

  it('古いモーダルの解除処理が新しい handler を消さない', async () => {
    const {
      registerDeleteAccountBackHandler,
      consumeDeleteAccountBack,
    } = await import('./appMenuState.js')
    const oldHandler = vi.fn()
    const newHandler = vi.fn()
    const unregisterOld = registerDeleteAccountBackHandler(oldHandler)
    const unregisterNew = registerDeleteAccountBackHandler(newHandler)

    unregisterOld()
    expect(consumeDeleteAccountBack()).toBe(true)
    expect(oldHandler).not.toHaveBeenCalled()
    expect(newHandler).toHaveBeenCalledTimes(1)

    unregisterNew()
    expect(consumeDeleteAccountBack()).toBe(false)
  })
})
