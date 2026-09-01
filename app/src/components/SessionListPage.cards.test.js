// ホーム（セッション一覧）のカードは大きさをそろえる。
//
// 角丸・内余白・枠線の太さ・カード間の余白を各カードが個別に書いていたため、
// 14px と 18px、padding 12/13/14/16/18px、border 1.5px と 2px が混在し、
// 同じ列に並んだときに別物に見えていた。1か所（--card-*）で決めて全カードが参照する。
//
// 色とテーマ（棚卸=青 / 仕入れ=緑 / 発注=オレンジ）、強調の影・呼吸アニメーションは
// カードごとの役割なのでそろえない。ここで固定するのは寸法だけ。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest の root は app/。実ファイルを読んでスタイル宣言そのものを見る
const src = readFileSync(resolve('src/components/SessionListPage.vue'), 'utf-8')

// ホームに並ぶカード（枠を持ち、単独で1枚に見える要素）
const CARDS = [
  '.master-card',      // データ管理
  '.hero-live',        // 進行中の棚卸
  '.hero-start',       // 棚卸を開始
  '.history-link',     // 履歴
  '.move-start',       // 仕入れ
  '.order-live',       // 進行中の発注
  '.session-card',     // 未完了セッションの行
  '.dashboard-card',   // メニュー側（分析・設定・ヘルプ）
]

function rule(selector) {
  const i = src.indexOf(`${selector} {`)
  return i < 0 ? null : src.slice(i, src.indexOf('}', i))
}

describe('ホームのカードは寸法をそろえる', () => {
  it('共通の寸法をパネルで1か所に定義している', () => {
    const panel = rule('.tab-panel')
    for (const token of ['--card-radius', '--card-pad-y', '--card-pad-x', '--card-border', '--card-gap']) {
      expect(panel, `${token} が .tab-panel に無い`).toContain(token)
    }
  })

  it.each(CARDS)('%s は共通の角丸・内余白・枠線を使う', selector => {
    const body = rule(selector)
    expect(body, `${selector} のスタイルが見つからない`).toBeTruthy()
    expect(body).toContain('border-radius: var(--card-radius)')
    expect(body).toContain('padding: var(--card-pad-y) var(--card-pad-x)')
    expect(body).toMatch(/border:\s*var\(--card-border\)/)
  })

  it.each(CARDS)('%s は寸法を直値で上書きしない', selector => {
    const body = rule(selector)
    // 角丸・内余白・枠線の太さに px 直値が残っていたら、そこからまたずれていく
    expect(body).not.toMatch(/border-radius:\s*\d/)
    expect(body).not.toMatch(/padding:\s*\d/)
    expect(body).not.toMatch(/border:\s*[\d.]+px/)
  })

  it('カード間の余白も共通値でそろえる', () => {
    // 縦に積むカードだけが下余白を持つ（session-card / dashboard-card は親の gap で並ぶ）
    for (const selector of ['.master-card', '.hero-live', '.hero-start', '.history-link', '.move-start', '.order-live']) {
      expect(rule(selector), selector).toContain('margin-bottom: var(--card-gap)')
    }
  })
})
