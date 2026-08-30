import { describe, it, expect } from 'vitest'
import {
  buildResultUrl, viewDaysRemaining, resultShareText, completedAtMs, RESULT_WINDOW_DAYS,
} from './resultShare.js'

const LOC = { origin: 'https://inventory-app-c40.pages.dev', pathname: '/' }
const SID = '11111111-1111-4111-8111-111111111111'

describe('buildResultUrl', () => {
  it('店舗コードとセッションIDを鍵にしたURLを作る', () => {
    expect(buildResultUrl('ABCDEF', SID, LOC))
      .toBe(`https://inventory-app-c40.pages.dev?store=ABCDEF&s=${SID}`)
  })

  // 招待リンク（useSync.getShareUrl）と同じ形でなければ、App.vue の入口が拾えない。
  it('末尾スラッシュを重ねない', () => {
    expect(buildResultUrl('ABCDEF', SID, { origin: 'https://x.dev', pathname: '/app/' }))
      .toBe(`https://x.dev/app?store=ABCDEF&s=${SID}`)
  })

  it('片方でも欠けたら空文字（壊れたリンクを配らせない）', () => {
    expect(buildResultUrl('', SID, LOC)).toBe('')
    expect(buildResultUrl('ABCDEF', '', LOC)).toBe('')
  })

  it('URLに使えない文字を含む値をエスケープする', () => {
    expect(buildResultUrl('AB CD', 'a&b=c', LOC))
      .toBe('https://inventory-app-c40.pages.dev?store=AB%20CD&s=a%26b%3Dc')
  })
})

describe('completedAtMs', () => {
  it('savedAt を優先する', () => {
    const snap = { savedAt: '2026-06-30T09:00:00.000Z', date: '2026-06-01' }
    expect(completedAtMs(snap)).toBe(new Date('2026-06-30T09:00:00.000Z').getTime())
  })

  it('savedAt が無ければ棚卸日の0時', () => {
    expect(completedAtMs({ date: '2026-06-30' })).toBe(new Date('2026-06-30T00:00:00').getTime())
  })

  it('どちらも無ければ null（0 に丸めない）', () => {
    expect(completedAtMs({})).toBeNull()
    expect(completedAtMs(null)).toBeNull()
  })
})

describe('viewDaysRemaining', () => {
  const now = new Date('2026-06-30T12:00:00.000Z').getTime()
  const at  = (hoursAgo) => ({ savedAt: new Date(now - hoursAgo * 3600_000).toISOString() })

  it('完了直後は上限日数ぶん残る', () => {
    expect(viewDaysRemaining(at(0), now)).toBe(RESULT_WINDOW_DAYS)
  })

  it('期限を過ぎたら 0', () => {
    expect(viewDaysRemaining(at(RESULT_WINDOW_DAYS * 24 + 1), now)).toBe(0)
  })

  // 境界。ちょうど期限の瞬間は「切れている」側に倒す（サーバーの > 判定と食い違わせない）。
  it('ちょうど期限なら 0', () => {
    expect(viewDaysRemaining(at(RESULT_WINDOW_DAYS * 24), now)).toBe(0)
  })

  it('判定できなければ null', () => {
    expect(viewDaysRemaining({}, now)).toBeNull()
  })
})

describe('resultShareText', () => {
  const now = Date.now()

  it('日付と残り日数を添える', () => {
    const text = resultShareText({ date: '2026-06-30', savedAt: new Date(now).toISOString() })
    expect(text).toContain('2026/06/30 の棚卸結果です')
    expect(text).toContain(`あと${RESULT_WINDOW_DAYS}日`)
  })

  it('期限切れなら残り日数を書かない', () => {
    const old = new Date(now - (RESULT_WINDOW_DAYS + 1) * 86400_000).toISOString()
    const text = resultShareText({ date: '2026-06-01', savedAt: old })
    expect(text).not.toContain('あと')
  })
})
