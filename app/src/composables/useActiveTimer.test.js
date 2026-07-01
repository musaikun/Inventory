import { describe, it, expect } from 'vitest'
import { computeActive, useActiveTimer, PAUSE_THRESHOLD_MS } from './useActiveTimer.js'

const T0 = 1_000_000_000_000
const MIN = 60_000

describe('computeActive（稼働時間/一時停止の判定）', () => {
  it('未開始（lastActivityAt=0）は0・非停止', () => {
    expect(computeActive({ activeMs: 0, lastActivityAt: 0 }, T0)).toEqual({ elapsedMs: 0, paused: false })
  })

  it('稼働中は確定分＋経過の尾を返す', () => {
    const r = computeActive({ activeMs: 3 * MIN, lastActivityAt: T0 }, T0 + 2 * MIN)
    expect(r.paused).toBe(false)
    expect(r.elapsedMs).toBe(5 * MIN)
  })

  it('閾値ちょうどで一時停止になり、尾は加算されない', () => {
    const r = computeActive({ activeMs: 10 * MIN, lastActivityAt: T0 }, T0 + PAUSE_THRESHOLD_MS)
    expect(r.paused).toBe(true)
    expect(r.elapsedMs).toBe(10 * MIN)   // アイドル分は除外
  })

  it('閾値直前はまだ稼働中', () => {
    const r = computeActive({ activeMs: 0, lastActivityAt: T0 }, T0 + PAUSE_THRESHOLD_MS - 1)
    expect(r.paused).toBe(false)
  })
})

describe('useActiveTimer', () => {
  it('start で初期化、mark で閾値未満ギャップを加算', () => {
    const t = useActiveTimer()
    t.start(T0)
    t.mark(T0 + 1 * MIN)    // +1分（稼働）
    t.mark(T0 + 3 * MIN)    // +2分（稼働）
    expect(t.activeMs.value).toBe(3 * MIN)
  })

  it('閾値以上のギャップ（離席）は加算しない＝アイドル除外', () => {
    const t = useActiveTimer()
    t.start(T0)
    t.mark(T0 + 1 * MIN)              // +1分
    t.mark(T0 + 1 * MIN + 8 * MIN)    // 8分のギャップ（離席）→ 加算なし
    expect(t.activeMs.value).toBe(1 * MIN)
  })

  it('離席→操作再開で自動的に計測が続く（再開後のギャップは加算）', () => {
    const t = useActiveTimer()
    t.start(T0)
    t.mark(T0 + 2 * MIN)                   // 稼働2分
    const back = T0 + 2 * MIN + 10 * MIN   // 10分離席
    t.mark(back)                           // 離席分は無視
    t.mark(back + 1 * MIN)                 // 再開後+1分
    expect(t.activeMs.value).toBe(3 * MIN)
  })

  it('isPaused は最終操作から閾値以上で true', () => {
    const t = useActiveTimer()
    t.start(T0)
    t.mark(T0 + 1 * MIN)
    expect(t.isPaused(T0 + 1 * MIN + 2 * MIN)).toBe(false)
    expect(t.isPaused(T0 + 1 * MIN + PAUSE_THRESHOLD_MS)).toBe(true)
  })

  it('resume は保存済み稼働時間から継続する', () => {
    const t = useActiveTimer()
    t.resume(7 * MIN, T0)
    t.mark(T0 + 2 * MIN)
    expect(t.activeMs.value).toBe(9 * MIN)
  })
})
