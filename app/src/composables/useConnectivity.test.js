import { describe, it, expect, vi } from 'vitest'

async function fresh() {
  vi.resetModules()
  return import('./useConnectivity.js')
}

describe('useConnectivity', () => {
  it('online/offline イベントで isOnline が切り替わる', async () => {
    const { isOnline, initConnectivity } = await fresh()
    initConnectivity()
    window.dispatchEvent(new Event('offline'))
    expect(isOnline.value).toBe(false)
    window.dispatchEvent(new Event('online'))
    expect(isOnline.value).toBe(true)
  })

  it('接続復帰で onReconnect コールバックが発火する', async () => {
    const { initConnectivity, onReconnect } = await fresh()
    initConnectivity()
    const fn = vi.fn()
    onReconnect(fn)
    window.dispatchEvent(new Event('online'))
    expect(fn).toHaveBeenCalled()
  })
})
