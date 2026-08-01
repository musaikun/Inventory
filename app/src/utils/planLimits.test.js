import { describe, it, expect, beforeEach } from 'vitest'
import {
  isPro, isProReviewEnvironment, canJoinRoom, canAddItem, remainingItemSlots,
  FREE_DEVICE_LIMIT, FREE_ITEM_LIMIT, FREE_HISTORY_COUNT,
} from './planLimits.js'

describe('planLimits（無料プラン制限）', () => {
  beforeEach(() => localStorage.clear())

  it('既定値は 2台・150品目・履歴3回', () => {
    expect(FREE_DEVICE_LIMIT).toBe(2)
    expect(FREE_ITEM_LIMIT).toBe(150)
    expect(FREE_HISTORY_COUNT).toBe(3)
  })

  describe('isPro', () => {
    it('通常buildでは false', () => {
      expect(isPro()).toBe(false)
    })
    it('localStorageの自己申告ではPROにならない', () => {
      localStorage.setItem('tanaoro_is_pro', '1')
      expect(isPro()).toBe(false)
    })
    it('専用channelとplanが両方一致したPro Reviewだけ true', () => {
      expect(isProReviewEnvironment({
        VITE_DEPLOYMENT_CHANNEL: 'pro-review',
        VITE_REVIEW_PLAN: 'pro',
      })).toBe(true)
    })
    it('片方だけ・大文字違い・未知値では false', () => {
      expect(isProReviewEnvironment({ VITE_REVIEW_PLAN: 'pro' })).toBe(false)
      expect(isProReviewEnvironment({
        VITE_DEPLOYMENT_CHANNEL: 'develop',
        VITE_REVIEW_PLAN: 'pro',
      })).toBe(false)
      expect(isProReviewEnvironment({
        VITE_DEPLOYMENT_CHANNEL: 'pro-review',
        VITE_REVIEW_PLAN: 'PRO',
      })).toBe(false)
    })
  })

  describe('canJoinRoom（2台まで）', () => {
    it('無料: 1台接続中は参加可（2台目）', () => {
      expect(canJoinRoom(1)).toBe(true)
    })
    it('無料: 2台接続中は参加不可（3台目）', () => {
      expect(canJoinRoom(2)).toBe(false)
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
  })
})
