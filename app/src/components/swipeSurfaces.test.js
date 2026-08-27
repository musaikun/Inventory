// 横スワイプを受け持つ要素は、必ずブラウザから横ジェスチャを引き取る。
//
// User報告: 振り分けで「分類先をタップして進む」なら戻るは何度でも効くのに、
// 「スワイプで進む」を繰り返すとアプリが閉じた。
// 原因は touch-action の宣言漏れ。宣言しないと Android Chrome が同じ指の動きを
// 「進む・戻る」のエッジ操作としても処理し、履歴を横取りする。
// このアプリは戻るを履歴の受け皿で捕まえているので、横取りされると受け皿が消えて
// 次の戻るでアプリごと閉じる。タップ経由では履歴に触らないので起きなかった。
//
// SessionListPage / SessionDetailPage は最初から宣言していて問題が出ていなかった。
// 漏れていた側を揃え、以後の追加でも漏れないようこのテストで固定する。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

// [ファイル, 横ジェスチャを引き取る要素のセレクタ]
// touch-action はヒットした要素と祖先の指定を合わせて効くので、
// スワイプを受け取る要素そのものでも、その内側のパネルでもよい。
const SURFACES = [
  ['./AxisAssignFocus.vue',   '.af-viewport'],    // 分類先一覧 ⇄ 品目一覧
  ['./MovementPage.vue',      '.mv-scroll'],      // 仕入れのタブ送り
  ['./HistoryCalendar.vue',   '.hc-cal'],         // カレンダーの月送り
  ['./SessionListPage.vue',   '.tab-panel'],      // ホームのページ送り
  ['./SessionDetailPage.vue', '.tab-panel'],      // セッション詳細のタブ送り
  ['../style.css',            '.modal-sheet'],    // ConfirmModal の品目送り
]

// セレクタのルール本体（`.foo { ... }`）を取り出す
function rule(src, selector) {
  const i = src.indexOf(`${selector} {`)
  if (i < 0) return null
  return src.slice(i, src.indexOf('}', i))
}

describe('横スワイプ面は touch-action で横ジェスチャを引き取る', () => {
  it.each(SURFACES)('%s の %s', (file, selector) => {
    const body = rule(read(file), selector)
    expect(body, `${selector} のスタイルが見つからない`).toBeTruthy()
    // pan-y = 縦だけブラウザに任せる。none でも横は引き取れる
    expect(body).toMatch(/touch-action:\s*(pan-y|none)/)
  })
})
