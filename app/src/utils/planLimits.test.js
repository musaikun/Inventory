import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isPro, isProReviewEnvironment, canJoinRoom, canAddItem, remainingItemSlots,
  itemLimit, historyLimit, limitsEnforced, setFreeLimitsEnforced,
  FREE_DEVICE_LIMIT, FREE_ITEM_LIMIT, FREE_HISTORY_COUNT,
} from './planLimits.js'

// 無料枠の上限は 2026-08-30 に既定 off にした（実運用優先・planLimits.js 参照）。
// 上限そのものが正しく効くかは残しておきたいので、この束では明示的に on にして検証する。
beforeEach(() => setFreeLimitsEnforced(true))
afterEach(()  => setFreeLimitsEnforced())

// 2026-08-30、User の判断で無料枠の上限を一時的に外した（実運用が先に来たため）。
// 既定が off であることと、off のとき**どの経路も止めない**ことをここで固定する。
// 戻すときは planLimits.js の DEFAULT_LIMITS_ENFORCED を true にするだけで、
// 上の「効いているとき」の期待値がそのまま生きる。
describe('上限を外している状態（現在の既定）', () => {
  beforeEach(() => setFreeLimitsEnforced())   // 既定へ戻す

  it('既定では上限を効かせない', () => {
    expect(limitsEnforced()).toBe(false)
  })

  it('台数・品目とも止めない', () => {
    expect(canJoinRoom(99)).toBe(true)
    expect(canAddItem(9999)).toBe(true)
  })

  it('残り枠と上限は Infinity（画面に「残り0」を出さない）', () => {
    expect(remainingItemSlots(9999)).toBe(Infinity)
    expect(itemLimit()).toBe(Infinity)
    expect(historyLimit()).toBe(Infinity)
  })

  it('値そのものは消していない（戻せる）', () => {
    expect(FREE_ITEM_LIMIT).toBe(150)
    expect(FREE_DEVICE_LIMIT).toBe(2)
    expect(FREE_HISTORY_COUNT).toBe(3)
  })
})

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
