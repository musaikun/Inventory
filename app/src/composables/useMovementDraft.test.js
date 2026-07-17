import { describe, it, expect, beforeEach } from 'vitest'
import { useMovementDraft } from './useMovementDraft.js'

const { draft, hasDraft, draftCount, clearMode } = useMovementDraft()

function reset() {
  draft.in = {}
  draft.out = {}
  draft.noteIn = ''
  draft.noteOut = ''
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

  it('clearMode(in) は入庫・入庫メモ・発注紐付けを消し、出庫は残す', () => {
    draft.in['トマト'] = 3
    draft.out['ビール'] = 2
    draft.orderId = 'o_1'
    draft.orderLabel = '7/1 八百屋'
    draft.noteIn = '納品分'
    draft.noteOut = 'まかない'
    clearMode('in')
    expect(draft.in).toEqual({})
    expect(draft.out).toEqual({ ビール: 2 })  // 出庫は保持
    expect(draft.orderId).toBeNull()
    expect(draft.orderLabel).toBe('')
    expect(draft.noteIn).toBe('')
    expect(draft.noteOut).toBe('まかない')    // 出庫メモは保持
    expect(draftCount.value).toBe(1)
  })

  // R2-02 リグレッション: 出庫の保存が入庫の発注紐付け・メモを消してはいけない
  it('clearMode(out) は入庫の発注紐付け・入庫メモを消さない（データの環を守る）', () => {
    draft.in['トマト'] = 3
    draft.out['ビール'] = 2
    draft.orderId = 'o_1'
    draft.orderLabel = '7/1 八百屋'
    draft.noteIn = '7/1発注分の納品'
    draft.noteOut = 'まかない'
    clearMode('out')
    expect(draft.out).toEqual({})
    expect(draft.noteOut).toBe('')
    expect(draft.in).toEqual({ トマト: 3 })   // 入庫は保持
    expect(draft.orderId).toBe('o_1')          // 発注紐付けを守る
    expect(draft.orderLabel).toBe('7/1 八百屋')
    expect(draft.noteIn).toBe('7/1発注分の納品')
  })
})
