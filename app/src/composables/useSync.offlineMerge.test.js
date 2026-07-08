import { describe, it, expect } from 'vitest'
import { resolveOfflineItem } from './useSync.js'

// disc = 切断時刻。updatedAt > disc を「オフライン中に変更」とみなす。
const DISC = 1000

describe('resolveOfflineItem（オフライン再接続の品目解決）', () => {
  it('自分だけ変更（相手は未変更）→ local（再送信）', () => {
    const local  = { qty: 5, unit: '個', updatedAt: 2000 }
    const server = { qty: 5, unit: '個', updatedAt: 400 }
    expect(resolveOfflineItem(local, server, DISC)).toBe('local')
  })

  it('自分がオフラインで追加（サーバーに無い）→ local', () => {
    const local = { qty: 3, unit: '本', updatedAt: 1500 }
    expect(resolveOfflineItem(local, undefined, DISC)).toBe('local')
  })

  it('相手だけ変更（自分は未変更）→ server', () => {
    const local  = { qty: 5, unit: '個', updatedAt: 500 }
    const server = { qty: 8, unit: '個', updatedAt: 2000 }
    expect(resolveOfflineItem(local, server, DISC)).toBe('server')
  })

  it('両方が変更して値が違う → conflict', () => {
    const local  = { qty: 5, unit: '個', updatedAt: 2000 }
    const server = { qty: 8, unit: '個', updatedAt: 1500 }
    expect(resolveOfflineItem(local, server, DISC)).toBe('conflict')
  })

  it('両方が変更しても値が同じなら conflict にしない（local扱い）', () => {
    const local  = { qty: 5, unit: '個', updatedAt: 2000 }
    const server = { qty: 5, unit: '個', updatedAt: 1500 }
    expect(resolveOfflineItem(local, server, DISC)).toBe('local')
  })

  it('どちらも未変更でサーバーに値あり → server（冪等適用）', () => {
    const local  = { qty: 5, unit: '個', updatedAt: 500 }
    const server = { qty: 5, unit: '個', updatedAt: 400 }
    expect(resolveOfflineItem(local, server, DISC)).toBe('server')
  })

  it('相手が削除＆自分は未変更 → null（据え置き・誤消し防止）', () => {
    const local = { qty: 5, unit: '個', updatedAt: 500 }
    expect(resolveOfflineItem(local, undefined, DISC)).toBe(null)
  })

  it('両方に無い → null', () => {
    expect(resolveOfflineItem(undefined, undefined, DISC)).toBe(null)
  })
})
