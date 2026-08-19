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

describe('閉じてはいけないモーダルの Back guard（IMPORT-001）', () => {
  beforeEach(() => { vi.resetModules() })

  it('登録が無ければ Back を止めない', async () => {
    const { isBackBlocked } = await import('./appMenuState.js')
    expect(isBackBlocked()).toBe(false)
  })

  it('guard が true を返すあいだだけ Back を止める', async () => {
    const { registerModalBackGuard, isBackBlocked } = await import('./appMenuState.js')
    let blocking = false
    const unregister = registerModalBackGuard(() => blocking)

    expect(isBackBlocked()).toBe(false)
    blocking = true
    expect(isBackBlocked()).toBe(true)
    blocking = false
    expect(isBackBlocked()).toBe(false)

    unregister()
  })

  it('解除すると止めなくなる（モーダルの unmount 後に残らない）', async () => {
    const { registerModalBackGuard, isBackBlocked } = await import('./appMenuState.js')
    const unregister = registerModalBackGuard(() => true)
    expect(isBackBlocked()).toBe(true)

    unregister()
    expect(isBackBlocked()).toBe(false)
  })

  it('複数登録では1つでも true なら止める', async () => {
    const { registerModalBackGuard, isBackBlocked } = await import('./appMenuState.js')
    const off1 = registerModalBackGuard(() => false)
    const off2 = registerModalBackGuard(() => true)
    expect(isBackBlocked()).toBe(true)

    off2()
    expect(isBackBlocked()).toBe(false)
    off1()
  })

  it('guard が例外を投げても Back 制御を壊さない', async () => {
    const { registerModalBackGuard, isBackBlocked } = await import('./appMenuState.js')
    const off = registerModalBackGuard(() => { throw new Error('boom') })
    expect(isBackBlocked()).toBe(false)
    off()
  })
})
