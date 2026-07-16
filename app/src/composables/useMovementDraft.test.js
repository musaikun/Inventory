import { describe, it, expect, beforeEach } from 'vitest'
import { useMovementDraft } from './useMovementDraft.js'

const { draft, hasDraft, draftCount, clearMode } = useMovementDraft()

function reset() {
  draft.in = {}
  draft.out = {}
  draft.note = ''
  draft.orderId = null
  draft.orderLabel = ''
}

describe('useMovementDraft（未記録入出庫のドラフト）', () => {
  beforeEach(reset)

  it('入力が無ければ hasDraft は false・count は 0', () => {
    expect(hasDraft.value).toBe(false)
    expect(draftCount.value).toBe(0)
  })

  it('入庫・出庫の qty>0 の品目数を数える', () => {
    draft.in['トマト'] = 3
    draft.in['なす'] = 0        // 0 は数えない
    draft.out['ビール'] = 2
    expect(draftCount.value).toBe(2)
    expect(hasDraft.value).toBe(true)
  })

  it('clearMode は指定モードと発注紐付け・メモを消し、他モードは残す', () => {
    draft.in['トマト'] = 3
    draft.out['ビール'] = 2
    draft.orderId = 'o_1'
    draft.orderLabel = '7/1 八百屋'
    draft.note = '納品分'
    clearMode('in')
    expect(draft.in).toEqual({})
    expect(draft.out).toEqual({ ビール: 2 })  // 他モードは保持
    expect(draft.orderId).toBeNull()
    expect(draft.orderLabel).toBe('')
    expect(draft.note).toBe('')
    expect(draftCount.value).toBe(1)
  })
})
