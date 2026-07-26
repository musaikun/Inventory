import { describe, it, expect } from 'vitest'
import { isDeleteAccountRoute } from './startupRoute.js'

// 公開Web削除リソース（Play の Data deletion URL）は未install・未loginでも到達する必要がある。
// App.vue はこの判定を認証・room・session 復元より先に評価する。
describe('isDeleteAccountRoute', () => {
  it('?delete-account（値なし）で true', () => {
    expect(isDeleteAccountRoute('?delete-account')).toBe(true)
  })

  it('先頭の ? が無くても true', () => {
    expect(isDeleteAccountRoute('delete-account')).toBe(true)
  })

  it('値付き（?delete-account=1）でも true', () => {
    expect(isDeleteAccountRoute('?delete-account=1')).toBe(true)
  })

  it('他パラメータと併用しても true', () => {
    expect(isDeleteAccountRoute('?utm_source=play&delete-account')).toBe(true)
  })

  it('無関係な URL では false（通常起動を妨げない）', () => {
    expect(isDeleteAccountRoute('')).toBe(false)
    expect(isDeleteAccountRoute('?room=ABCDEF&s=1')).toBe(false)
    expect(isDeleteAccountRoute('?store=ABCDEF')).toBe(false)
  })

  it('部分一致では反応しない', () => {
    expect(isDeleteAccountRoute('?delete-account-x')).toBe(false)
    expect(isDeleteAccountRoute('?xdelete-account')).toBe(false)
  })

  it('null / undefined でも例外を投げず false', () => {
    expect(isDeleteAccountRoute(null)).toBe(false)
    expect(isDeleteAccountRoute(undefined)).toBe(false)
  })
})
