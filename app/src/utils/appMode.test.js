import { describe, it, expect, beforeEach, vi } from 'vitest'

async function importFresh({ referrer = '', search = '', stored = null } = {}) {
  vi.resetModules()
  const store = {}
  if (stored !== null) store['tanaoro_is_twa'] = stored
  vi.stubGlobal('localStorage', {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: k => { delete store[k] },
  })
  vi.stubGlobal('document', { referrer })
  vi.stubGlobal('window', { location: { search } })
  const mod = await import('./appMode.js')
  return { mod, store }
}

describe('isTwaApp', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('通常のブラウザ起動では false', async () => {
    const { mod } = await importFresh({ referrer: 'https://google.com', search: '' })
    expect(mod.isTwaApp()).toBe(false)
  })

  it('android-app:// リファラーで true・localStorage に永続化', async () => {
    const { mod, store } = await importFresh({ referrer: 'android-app://com.tanaoro.twa' })
    expect(mod.isTwaApp()).toBe(true)
    expect(store['tanaoro_is_twa']).toBe('1')
  })

  it('?twa=1 マーカーで true', async () => {
    const { mod } = await importFresh({ search: '?twa=1' })
    expect(mod.isTwaApp()).toBe(true)
  })

  it('過去に検知済み（localStorage=1）なら true', async () => {
    const { mod } = await importFresh({ stored: '1' })
    expect(mod.isTwaApp()).toBe(true)
  })

  it('結果はキャッシュされ、複数回呼んでも同一', async () => {
    const { mod } = await importFresh({ referrer: 'android-app://x' })
    expect(mod.isTwaApp()).toBe(true)
    expect(mod.isTwaApp()).toBe(true)
  })
})
