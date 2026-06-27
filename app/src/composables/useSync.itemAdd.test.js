import { describe, it, expect, beforeEach } from 'vitest'
import { pendingItemRequests, dismissItemAddRequest } from './useSync.js'

describe('ゲスト品目追加申請キュー（ホスト側）', () => {
  beforeEach(() => pendingItemRequests.splice(0, pendingItemRequests.length))

  it('dismissItemAddRequest は requestId 一致分だけ取り除く', () => {
    pendingItemRequests.push(
      { requestId: 'r1', name: 'A' },
      { requestId: 'r2', name: 'B' },
      { requestId: 'r3', name: 'C' },
    )
    dismissItemAddRequest('r2')
    expect(pendingItemRequests.map(r => r.requestId)).toEqual(['r1', 'r3'])
  })

  it('存在しない requestId は何もしない', () => {
    pendingItemRequests.push({ requestId: 'r1', name: 'A' })
    dismissItemAddRequest('zzz')
    expect(pendingItemRequests).toHaveLength(1)
  })

  it('空キューでも例外なく動く', () => {
    expect(() => dismissItemAddRequest('r1')).not.toThrow()
    expect(pendingItemRequests).toHaveLength(0)
  })
})
