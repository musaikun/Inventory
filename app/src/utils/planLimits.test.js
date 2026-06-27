import { describe, it, expect, beforeEach } from 'vitest'
import {
  isPro, canJoinRoom, canAddItem, remainingItemSlots,
  FREE_DEVICE_LIMIT, FREE_ITEM_LIMIT, FREE_HISTORY_COUNT,
} from './planLimits.js'

const PRO_KEY = 'tanaoro_is_pro'

describe('planLimits（無料プラン制限）', () => {
  beforeEach(() => localStorage.clear())

  it('既定値は 3台・150品目・履歴1回', () => {
    expect(FREE_DEVICE_LIMIT).toBe(3)
    expect(FREE_ITEM_LIMIT).toBe(150)
    expect(FREE_HISTORY_COUNT).toBe(1)
  })

  describe('isPro', () => {
    it('フラグ未設定なら false', () => {
      expect(isPro()).toBe(false)
    })
    it('tanaoro_is_pro=1 なら true', () => {
      localStorage.setItem(PRO_KEY, '1')
      expect(isPro()).toBe(true)
    })
    it('1 以外の値は false', () => {
      localStorage.setItem(PRO_KEY, 'true')
      expect(isPro()).toBe(false)
    })
  })

  describe('canJoinRoom（3台まで）', () => {
    it('無料: 2台接続中は参加可（3台目）', () => {
      expect(canJoinRoom(2)).toBe(true)
    })
    it('無料: 3台接続中は参加不可（4台目）', () => {
      expect(canJoinRoom(3)).toBe(false)
    })
    it('PRO: 何台でも参加可', () => {
      localStorage.setItem(PRO_KEY, '1')
      expect(canJoinRoom(99)).toBe(true)
    })
  })

  describe('canAddItem（150品目まで）', () => {
    it('無料: 149品目なら追加可（150件目）', () => {
      expect(canAddItem(149)).toBe(true)
    })
    it('無料: 150品目ちょうどは追加不可（151件目）', () => {
      expect(canAddItem(150)).toBe(false)
    })
    it('無料: 0品目は追加可', () => {
      expect(canAddItem(0)).toBe(true)
    })
    it('PRO: 上限なし', () => {
      localStorage.setItem(PRO_KEY, '1')
      expect(canAddItem(10000)).toBe(true)
    })
  })

  describe('remainingItemSlots（残り登録可能数）', () => {
    it('無料: 100品目なら残り50', () => {
      expect(remainingItemSlots(100)).toBe(50)
    })
    it('無料: 上限到達なら残り0', () => {
      expect(remainingItemSlots(150)).toBe(0)
    })
    it('無料: 上限超過でも負にならず0', () => {
      expect(remainingItemSlots(200)).toBe(0)
    })
    it('PRO: Infinity', () => {
      localStorage.setItem(PRO_KEY, '1')
      expect(remainingItemSlots(100)).toBe(Infinity)
    })
  })
})
