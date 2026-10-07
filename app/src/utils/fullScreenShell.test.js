/**
 * 全画面シェルの画面で、スクロールを二重にしない。
 *
 * `#app` は session ビューの `.app-footer` を避けるために `padding-bottom: 80px` を持つ。
 * ところが履歴プレビュー・ゲスト閲覧・セッション一覧は自前で
 * `height:100dvh; overflow:hidden` のシェルを組んでいる。そこへ下余白が付くと
 * 文書全体が **100dvh + 80px** になり、**画面内の品目一覧のスクロールとは別に
 * ページ自体も動く**。指を上下するたびにどちらが効くか変わり、ヘッダーが流れたり
 * 下に死んだ余白が出たりする（実機で確認・2026-08-31）。
 *
 * jsdom はレイアウトを計算しないので、ここでは **CSS の規則そのもの**を固定する。
 * 見た目のtestにはならないが、「この打ち消しを消すと二重スクロールが戻る」ことを
 * 次に触る人へ残せる。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest は app/ を cwd として実行する（jsdom 環境では import.meta.url が file: とは限らない）
const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')

/** `body[data-view="X"] #app` に padding-bottom:0 が当たっているか（media query の外） */
function clearsFooterPadding(view) {
  // 打ち消しの規則は1つにまとめてある。セレクタ群と宣言をまとめて拾う。
  const rules = css.match(/body\[data-view="[^"]+"\] #app[^{]*\{[^}]*\}/g) ?? []
  return rules.some(r =>
    r.includes(`body[data-view="${view}"] #app`) && /padding-bottom:\s*0/.test(r)
  )
}

describe('全画面シェルの下余白', () => {
  // 自前で height:100dvh + overflow:hidden を組んでいる画面
  it.each(['session-detail', 'guest-result', 'sessions'])(
    '%s は #app の footer 用 padding を打ち消す',
    (view) => { expect(clearsFooterPadding(view)).toBe(true) },
  )

  // session も画面の高さに固定し、表だけをスクロールする（User 2026-10-07・v0.148.2）。
  // そのときは .app-footer を固定配置にせず流れの一番下へ置くので、#app の下余白は要らない。
  // 下余白を残したまま固定配置に戻すと、フッターが表の最後の行に被る。
  it('session は打ち消し、フッターを流れの中に置く', () => {
    expect(clearsFooterPadding('session')).toBe(true)
    expect(/body\[data-view="session"\] #app > \.app-footer\s*\{[^}]*position:\s*static/.test(css)).toBe(true)
  })

  it('#app の footer 用 padding 自体は残っている', () => {
    expect(/#app\s*\{[^}]*padding-bottom:\s*80px/.test(css)).toBe(true)
  })
})
