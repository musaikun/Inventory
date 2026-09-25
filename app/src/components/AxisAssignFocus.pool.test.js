// 「○○ に振り分け中」の品目一覧から、使っていない食材をその場で隠せることの回帰。
// これまで非表示は「品目マスタ管理」だけの操作だったが、どの品目を使っていないかは
// 振り分け中が一番よく見える。隠す判断ができる場所に、隠す操作が無かった。
//
// 分類先はホイールへ移り、選ぶ画面と品目一覧の往復は無くなった。品目一覧は常に画面にある。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let cfg
let hidden       // App 側の onHideItem / onUnhideItem を模す

// 直近の棚卸履歴。トマトだけ入力があり、豚バラ・レタスは未使用。
function seedHistory() {
  localStorage.setItem('inventory_history_v1', JSON.stringify({
    's1': { date: '2026-08-20', sessionId: 's1', items: [
      { item: 'トマト', qty: 3 },
      { item: '豚バラ', qty: null },
      { item: 'レタス', qty: null },
    ] },
  }))
}

async function mount() {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Focus, {
      initialAxis: 0,
      onHideItem: n => { hidden.push(n); cfg.hideItem(n) },
      onUnhideItem: n => { hidden = hidden.filter(x => x !== n); cfg.unhideItem(n) },
    }),
  })
  app.mount(host)
  await nextTick()
  await openAllGenres()
  return host
}

// 取込元にジャンルがあるとアコーディオンで畳まれている（既定は閉）。
// 品目の行はその内側にあるので、見るには開く。
async function openAllGenres() {
  for (const head of host.querySelectorAll('.af-cat-head')) {
    // 開閉はトグルなので、閉じている（▶）ものだけ押す
    if (head.querySelector('.af-cat-arrow').textContent.trim() !== '▶') continue
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
  await nextTick()
}

const rows      = () => [...host.querySelectorAll('.af-item[data-item]')]
const rowNames  = () => rows().map(r => r.getAttribute('data-item'))
const rowOf     = name => rows().find(r => r.getAttribute('data-item') === name)
const action    = () => host.querySelector('.af-row-action')
const dialog    = () => host.querySelector('.af-hide-dialog')
const centre    = () => host.querySelector('.af-gcard.on .af-gname')?.textContent.trim()

// jsdom は TouchEvent を持たないので、ハンドラが見る changedTouches だけを載せる
function touch(el, type, x, y = 0) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  ev.changedTouches = [{ clientX: x, clientY: y }]
  el.dispatchEvent(ev)
}
// 行を dx だけ左へ引く（負の値）。離さずに止める
async function swipe(name, dx) {
  const el = rowOf(name)
  touch(el, 'touchstart', 300, 100)
  touch(el, 'touchmove', 300 + dx, 100)
  await nextTick()
  return el
}
async function release(el) {
  touch(el, 'touchend', 0, 0)
  await nextTick()
}
const undoBar   = () => host.querySelector('.af-undobar')
const chip      = label => [...host.querySelectorAll('.af-chip-btn')].find(b => b.textContent.trim() === label)

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  seedHistory()
  vi.resetModules()
  hidden = []
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  cfg.addItem('レタス', 200, '野菜', '個')
  cfg.setAxisName(0, '場所')
  cfg.addAxisGroup(0, '冷蔵庫')
  await nextTick()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('AxisAssignFocus — 振り分け中に一覧から非表示', () => {
  // 以前は行の右端に🚫を常設していたが、行タップ（振り分けの解除）と並んでいるため
  // 「取り消し」と読み違えて押す事故があった。棚卸の表と同じ左スワイプに載せ替える。
  it('行に常設の非表示ボタンを持たない', async () => {
    await mount()
    expect(host.querySelector('.af-ihide')).toBeNull()
    expect(action()).toBeNull()            // 引くまでアクションも出ない
  })

  it('浅く引くとアクションが出て、押すと確認してから消える', async () => {
    await mount()
    const el = await swipe('豚バラ', -60)
    expect(action().textContent.trim()).toBe('非表示')
    await release(el)

    await click(action())
    expect(dialog()).toBeTruthy()          // 浅いスワイプは確認をはさむ
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')

    await click(dialog().querySelector('.af-dialog-ok'))
    expect(hidden).toEqual(['豚バラ'])
    expect(cfg.config.hiddenItems).toContain('豚バラ')
    expect(rowNames()).not.toContain('豚バラ')
    expect(undoBar().textContent).toContain('豚バラ')
  })

  it('確認をキャンセルすると消えない', async () => {
    await mount()
    const el = await swipe('豚バラ', -60)
    await release(el)
    await click(action())
    await click(dialog().querySelector('.af-dialog-cancel'))

    expect(dialog()).toBeNull()
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
    expect(rowNames()).toContain('豚バラ')
  })

  it('引き切って離すと、確認なしでその場で消える', async () => {
    await mount()
    const el = await swipe('豚バラ', -300)
    expect(action().textContent.trim()).toBe('離すと非表示')
    await release(el)

    expect(dialog()).toBeNull()            // 全スワイプは確認を飛ばす
    expect(cfg.config.hiddenItems).toContain('豚バラ')
    expect(rowNames()).not.toContain('豚バラ')
  })

  it('元に戻すと一覧へ戻る', async () => {
    await mount()
    const el = await swipe('豚バラ', -300)
    await release(el)
    await click(host.querySelector('.af-undo-btn'))
    await openAllGenres()

    expect(hidden).toEqual([])
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
    expect(rowNames()).toContain('豚バラ')
  })

  it('スワイプ直後の click では振り分けされない', async () => {
    await mount()
    const el = await swipe('豚バラ', -60)
    await release(el)
    await click(el)                        // touchend 後に来る click
    expect(cfg.config.tagsA['豚バラ']).toBeUndefined()
  })

  it('縦に動かしたときは何も出ない（スクロールを妨げない）', async () => {
    await mount()
    const el = rowOf('豚バラ')
    touch(el, 'touchstart', 300, 100)
    touch(el, 'touchmove', 296, 180)       // ほぼ縦
    await nextTick()
    expect(action()).toBeNull()
    await release(el)
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
  })

  it('非表示は進捗の分母からも外れる', async () => {
    await mount()
    expect(host.querySelector('.af-prog-text').textContent).toContain('/ 3')
    const el = await swipe('豚バラ', -300)
    await release(el)
    expect(host.querySelector('.af-prog-text').textContent).toContain('/ 2')
  })
})

describe('AxisAssignFocus — 振り分け画面からの戻る', () => {
  it('開いているものが無ければ、戻るはこの画面を閉じる（ひとつ前へ返す）', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    expect(consumeInnerLayerBack()).toBe(false)   // App へ渡す＝データ管理へ戻る
  })

  it('モーダルが開いていれば、そちらを先に閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    // 中央カードのカウント＝振り分け済みシートを開くボタン
    await click(host.querySelector('.af-gcard.on .af-gcount'))
    expect(host.querySelector('.af-sheet')).toBeTruthy()

    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(host.querySelector('.af-sheet')).toBeNull()
    expect(centre()).toBe('冷蔵庫')                // 振り分け先は変わらない
    expect(host.querySelector('.af')).toBeTruthy() // 画面自体は閉じない
  })

  it('非表示の確認も、戻るで先に閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    const el = await swipe('豚バラ', -60)
    await release(el)
    await click(action())
    expect(dialog()).toBeTruthy()

    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(dialog()).toBeNull()
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
  })
})

/**
 * 数えていない品目の見分け（User指示 2026-09-21）。
 *
 * 以前は `未使用` の1種類しか無く、**何が未使用なのか読めなかった**。実際に見ているのは
 * 消費ではなく計測の有無なので `未計測` にし、窓（直近3回）も印に添える。
 * そのうえで理由を2つに分ける ── 前回リストに無かった品目（新規）は、数えようが無い。
 */
describe('AxisAssignFocus — 数えていない品目の見分け', () => {
  it('直近3回とも数量の無い品目に「直近3回 未計測」の印がつく', async () => {
    await mount()
    const marked = rows().filter(r => r.querySelector('.af-item-unused'))
      .map(r => r.getAttribute('data-item'))
    expect(marked.sort()).toEqual(['レタス', '豚バラ'].sort())   // トマトは入力済み
    const badge = rows().find(r => r.getAttribute('data-item') === '豚バラ')
      .querySelector('.af-item-unused')
    expect(badge.textContent).toContain('直近3回')
    expect(badge.textContent).toContain('未計測')
  })

  it('「未計測のみ」で隠す候補だけに絞れる', async () => {
    await mount()
    await click(chip('未計測のみ'))
    await openAllGenres()
    expect(rowNames().sort()).toEqual(['レタス', '豚バラ'].sort())
  })

  it('絞り込みの意味をその場に1行出す（チップの言葉だけでは読めない）', async () => {
    await mount()
    await click(chip('未計測のみ'))
    expect(host.querySelector('.af-filter-note').textContent).toContain('直近3回の棚卸で、一度も数量が入っていない')
  })

  it('3つの絞り込みは同時に立たない', async () => {
    await mount()
    await click(chip('前回入力のみ'))
    await openAllGenres()
    expect(rowNames()).toEqual(['トマト'])

    await click(chip('未計測のみ'))
    await openAllGenres()
    expect(chip('前回入力のみ').className).not.toContain('on')
    expect(rowNames().sort()).toEqual(['レタス', '豚バラ'].sort())

    await click(chip('新規のみ'))
    expect(chip('未計測のみ').className).not.toContain('on')
  })
})

describe('AxisAssignFocus — 新規（前回の棚卸には無かった品目）', () => {
  it('前回のリストに無かった品目は「新規」。未計測にはしない', async () => {
    cfg.addItem('新玉ねぎ', 100, '野菜', '個')
    await mount()
    await openAllGenres()
    const row = rows().find(r => r.getAttribute('data-item') === '新玉ねぎ')

    expect(row.querySelector('.af-item-new')).not.toBeNull()
    // 数えようが無かったのだから「ずっと数えていない」とは言わない
    expect(row.querySelector('.af-item-unused')).toBeNull()
  })

  it('「新規のみ」で、増えた品目だけに絞れる', async () => {
    cfg.addItem('新玉ねぎ', 100, '野菜', '個')
    await mount()
    await click(chip('新規のみ'))
    await openAllGenres()
    expect(rowNames()).toEqual(['新玉ねぎ'])
    expect(host.querySelector('.af-filter-note').textContent).toContain('前回の棚卸の時点では、リストに無かった')
  })

  it('棚卸が1度も無ければ、印も絞り込みも出さない（比べる相手が無い）', async () => {
    localStorage.removeItem('inventory_history_v1')
    await mount()
    await openAllGenres()
    expect(host.querySelector('.af-item-new')).toBeNull()
    expect(host.querySelector('.af-item-unused')).toBeNull()
    expect(chip('新規のみ')).toBeUndefined()
  })
})

describe('AxisAssignFocus — 非表示のみ（左スワイプで一覧に戻す）', () => {
  it('非表示の品目があるときだけチップを出し、押すと非表示の品目だけになる', async () => {
    await mount()
    expect(chip('非表示のみ')).toBeUndefined()
    app.unmount(); host.remove()
    cfg.hideItem('豚バラ')
    await mount()
    await click(chip('非表示のみ'))
    await openAllGenres()
    expect(rowNames()).toEqual(['豚バラ'])
    expect(host.textContent).toContain('左にスワイプすると一覧に戻せます')
  })

  it('他の絞り込みと同時には掛からない', async () => {
    cfg.hideItem('豚バラ')
    await mount()
    await click(chip('未計測のみ'))
    await click(chip('非表示のみ'))
    expect(chip('未計測のみ').classList.contains('on')).toBe(false)
    expect(chip('非表示のみ').classList.contains('on')).toBe(true)
  })

  it('引くと青い「表示に戻す」、引き切って離すとその場で一覧に戻り、取り消せる', async () => {
    cfg.hideItem('豚バラ')
    await mount()
    await click(chip('非表示のみ'))
    await openAllGenres()
    const el = await swipe('豚バラ', -300)
    expect(action().textContent.trim()).toBe('離すと表示')
    expect(action().style.background).toBe('rgb(37, 99, 235)')
    await release(el)
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
    expect(undoBar().textContent).toContain('一覧に戻しました')

    await click(host.querySelector('.af-undo-btn'))
    expect(cfg.config.hiddenItems).toContain('豚バラ')
  })

  it('浅く引いて押すと確認してから戻す', async () => {
    cfg.hideItem('豚バラ')
    await mount()
    await click(chip('非表示のみ'))
    await openAllGenres()
    const el = await swipe('豚バラ', -60)
    await release(el)
    expect(action().textContent.trim()).toBe('表示に戻す')
    await click(action())
    expect(dialog().textContent).toContain('一覧に戻しますか')
    await click([...dialog().querySelectorAll('button')].find(b => b.textContent.trim() === '一覧に戻す'))
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
  })

  it('非表示の品目はタップしても振り分けない', async () => {
    cfg.hideItem('豚バラ')
    await mount()
    await click(chip('非表示のみ'))
    await openAllGenres()
    await click(rowOf('豚バラ'))
    expect(cfg.config.tagsA['豚バラ']).toBeUndefined()
  })

  it('通常の表示では従来どおり赤で非表示にする', async () => {
    await mount()
    await swipe('豚バラ', -300)
    expect(action().style.background).toBe('rgb(220, 38, 38)')
  })
})

describe('AxisAssignFocus — 絞り込みの並びと左スワイプの案内', () => {
  it('「〜のみ」の4つは未振り分けのみとは別の1段に並ぶ', async () => {
    cfg.hideItem('レタス')
    await mount()
    const tools = host.querySelector('.af-tools')
    expect([...tools.querySelectorAll('.af-chip-btn')].map(b => b.textContent.trim())).toEqual(['未振り分けのみ'])
    const row = host.querySelector('.af-only-row')
    expect([...row.querySelectorAll('.af-chip-btn')].map(b => b.textContent.trim()))
      .toEqual(['前回入力のみ', '未計測のみ', '新規のみ', '非表示のみ'])
  })

  it('左スワイプで非表示にできると案内し、一度非表示にしたら消える', async () => {
    await mount()
    expect(host.querySelector('.af-pickhint').textContent).toContain('左にスワイプ')
    const el = await swipe('豚バラ', -300)
    await release(el)
    expect(host.querySelector('.af-pickhint')?.textContent ?? '').not.toContain('左にスワイプ')
  })
})
