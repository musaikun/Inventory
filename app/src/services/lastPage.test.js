// リロードで同じページに留まるための保存・読み出し。
// 対象外のページ（セッション・ホーム等）を保存しないことが肝心で、ここが緩むと
// 進行中セッションより古いページが復元先を横取りする。
import { describe, it, expect, beforeEach } from 'vitest'
import { saveLastPage, readLastPage, clearLastPage, RESTORABLE_PAGES } from './lastPage.js'

beforeEach(() => localStorage.clear())

describe('lastPage', () => {
  it('対象ページを保存して読み戻せる', () => {
    saveLastPage('movement', 'out')
    expect(readLastPage()).toEqual({ view: 'movement', tab: 'out' })
    // データ管理はホームの「管理」タブになった（独立ページは廃止）。保存しない・古い保存値も読まない
    saveLastPage('master')
    expect(readLastPage()).toBe(null)
    localStorage.setItem('_last_page_v1', JSON.stringify({ view: 'master' }))
    expect(readLastPage()).toBe(null)
    // 履歴カレンダーは独立した画面（レポートの一番上から）。再読み込みしても同じ画面
    saveLastPage('history')
    expect(readLastPage()).toEqual({ view: 'history', tab: 'in' })
  })

  it('入出庫はタブまで覚える', () => {
    saveLastPage('movement', 'out')
    expect(readLastPage()).toEqual({ view: 'movement', tab: 'out' })
  })

  it('未知のタブ・廃止したタブ（在庫・発注）は入庫に落とす', () => {
    saveLastPage('movement', 'なにか')
    expect(readLastPage()).toEqual({ view: 'movement', tab: 'in' })
    localStorage.setItem('_last_page_v1', JSON.stringify({ view: 'movement', tab: 'order' }))
    expect(readLastPage()).toEqual({ view: 'movement', tab: 'in' })
  })

  it('対象外のページは保存せず、保存済みも消す', () => {
    saveLastPage('movement', 'in')
    saveLastPage('session')
    expect(readLastPage()).toBe(null)

    saveLastPage('movement', 'in')
    saveLastPage('sessions')
    expect(readLastPage()).toBe(null)
  })

  it('未保存・壊れた値・対象外の保存値は null', () => {
    expect(readLastPage()).toBe(null)
    localStorage.setItem('_last_page_v1', '{壊れている')
    expect(readLastPage()).toBe(null)
    localStorage.setItem('_last_page_v1', JSON.stringify({ view: 'session' }))
    expect(readLastPage()).toBe(null)
  })

  it('clearLastPage で消える', () => {
    saveLastPage('movement', 'in')
    clearLastPage()
    expect(readLastPage()).toBe(null)
  })

  it('復元対象は独立ページ（入出庫・履歴カレンダー）だけ', () => {
    expect(RESTORABLE_PAGES).toEqual(['movement', 'history'])
  })
})
