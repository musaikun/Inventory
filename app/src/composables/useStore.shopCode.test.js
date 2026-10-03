// 店舗コードが "undefined" などに壊れない・壊れていたら直す（2026-10-03 本番で発生）
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('../utils/api.js', () => ({ HTTP_BASE: 'https://w.test', apiFetch: (...a) => apiFetch(...a), setAuthInvalidatedHandler: vi.fn() }))

beforeEach(() => { localStorage.clear(); vi.resetModules(); apiFetch.mockReset() })

describe('店舗コード', () => {
  it('保存値が "undefined" なら、データの持ち主の店舗コードで直す', async () => {
    localStorage.setItem('_shop_code', 'undefined')
    localStorage.setItem('_data_owner', 'KEJPFC')
    const { shopCode } = await import('./useStore.js')
    expect(shopCode.value).toBe('KEJPFC')
    expect(localStorage.getItem('_shop_code')).toBe('KEJPFC')
  })

  it('返事に店舗コードが無ければ、保存している店舗コードを書き換えない', async () => {
    localStorage.setItem('_shop_code', 'KEJPFC')
    const { shopCode, loadStore } = await import('./useStore.js')
    apiFetch.mockResolvedValueOnce({})
    await expect(loadStore('KEJPFC')).rejects.toThrow()
    expect(shopCode.value).toBe('KEJPFC')
    expect(localStorage.getItem('_shop_code')).toBe('KEJPFC')
  })
})
