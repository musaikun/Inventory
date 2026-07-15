import { describe, it, expect } from 'vitest'
import { canGrantHost } from './RoomDO.js'

// 監査 S-A: ホスト権限（再）発行の判定。
// PIN設定店舗（protectedStore）は D1 認証（authOk）必須で、店舗コードを知るだけの
// 第三者による乗っ取りを塞ぐ。レガシー店舗は従来のトポロジ判定を維持する。
describe('canGrantHost（ホスト権限の発行可否）', () => {
  describe('PIN設定店舗（protectedStore=true）', () => {
    it('D1認証OKなら、他に検証済みホストが居ても発行できる（正規ホストの奪還）', () => {
      expect(canGrantHost({
        protectedStore: true, authOk: true,
        isEmpty: false, sameDeviceHost: false, anyVerifiedHost: true,
      })).toBe(true)
    })

    it('D1認証NGなら、空室でも発行しない（乗っ取り防止の要）', () => {
      expect(canGrantHost({
        protectedStore: true, authOk: false,
        isEmpty: true, sameDeviceHost: false, anyVerifiedHost: false,
      })).toBe(false)
    })

    it('D1認証NGなら、ホスト不在（!anyVerifiedHost）でも発行しない', () => {
      expect(canGrantHost({
        protectedStore: true, authOk: false,
        isEmpty: false, sameDeviceHost: false, anyVerifiedHost: false,
      })).toBe(false)
    })

    it('D1認証NGなら、同一deviceIdを詐称しても発行しない', () => {
      expect(canGrantHost({
        protectedStore: true, authOk: false,
        isEmpty: false, sameDeviceHost: true, anyVerifiedHost: true,
      })).toBe(false)
    })
  })

  describe('レガシー店舗（protectedStore=false・後方互換）', () => {
    it('空室なら発行（再初期化）', () => {
      expect(canGrantHost({
        protectedStore: false, authOk: false,
        isEmpty: true, sameDeviceHost: false, anyVerifiedHost: false,
      })).toBe(true)
    })

    it('同一deviceIdのホスト残存なら発行（本人のオフライン復帰）', () => {
      expect(canGrantHost({
        protectedStore: false, authOk: false,
        isEmpty: false, sameDeviceHost: true, anyVerifiedHost: true,
      })).toBe(true)
    })

    it('ホスト不在なら発行（引き継ぎ）', () => {
      expect(canGrantHost({
        protectedStore: false, authOk: false,
        isEmpty: false, sameDeviceHost: false, anyVerifiedHost: false,
      })).toBe(true)
    })

    it('他に検証済みホストが居て、空室でも同端末でもなければ発行しない', () => {
      expect(canGrantHost({
        protectedStore: false, authOk: false,
        isEmpty: false, sameDeviceHost: false, anyVerifiedHost: true,
      })).toBe(false)
    })
  })
})
