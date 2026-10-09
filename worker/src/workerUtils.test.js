import { describe, it, expect, vi, afterEach } from 'vitest'
import { _genShopCode } from './workerUtils.js'

afterEach(() => vi.restoreAllMocks())

describe('_genShopCode', () => {
  it('紛らわしい I・O を除いた大文字6文字', () => {
    for (let i = 0; i < 500; i++) expect(_genShopCode()).toMatch(/^[A-HJ-NP-Z]{6}$/)
  })

  it('Math.random を使わない（予測できる乱数で店舗コードを作らない）', () => {
    const spy = vi.spyOn(Math, 'random')
    _genShopCode()
    expect(spy).not.toHaveBeenCalled()
  })

  it('240 以上のバイトは捨てて引き直す（剰余の偏りを出さない）', () => {
    // 1回目は全部 255（捨てる）→ 2回目で 0..7（A..H）
    let n = 0
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(a => {
      a.set(n++ === 0 ? new Array(a.length).fill(255) : [0, 1, 2, 3, 4, 5, 6, 7].slice(0, a.length))
      return a
    })
    expect(_genShopCode()).toBe('ABCDEF')
    expect(n).toBe(2)
  })
})
