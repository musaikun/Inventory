// 「○○ に振り分け中」の品目一覧から、使っていない食材をその場で隠せることの回帰。
// これまで非表示は「品目マスタ管理」だけの操作だったが、どの品目を使っていないかは
// 振り分け中が一番よく見える。隠す判断ができる場所に、隠す操作が無かった。
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
  // カードA でグループを選び、品目一覧（カードB）へ進む
  host.querySelector('.af-gcard').dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

    await click(host.querySelector('.af-hide-dialog-ok'))
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
    await click(host.querySelector('.af-hide-dialog-cancel'))

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

  it('行を引いても分類先の一覧へ戻らない（親のスワイプへ渡さない）', async () => {
    await mount()
    const track = () => host.querySelector('.af-track').style.transform

    const el = await swipe('豚バラ', -80)      // 左へ引く
    await release(el)
    expect(track()).toContain('calc(-50%')     // 品目一覧のまま

    // 開いたアクションを右へ引いて閉じるとき、親の「右スワイプ＝分類一覧へ戻る」を誘発しない
    touch(el, 'touchstart', 100, 100)
    touch(el, 'touchmove', 240, 100)
    await nextTick()
    await release(el)
    expect(track()).toContain('calc(-50%')
  })

  it('非表示は進捗の分母からも外れる', async () => {
    await mount()
    expect(host.querySelector('.af-prog-text').textContent).toContain('/ 3')
    const el = await swipe('豚バラ', -300)
    await release(el)
    expect(host.querySelector('.af-prog-text').textContent).toContain('/ 2')
  })
})

describe('AxisAssignFocus — 品目一覧からの戻る', () => {
  const track = () => host.querySelector('.af-track').style.transform

  it('端末の戻るは画面を閉じず、分類先の選択へスライドで返る', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    expect(track()).toContain('calc(-50%')            // 品目一覧に居る

    expect(consumeInnerLayerBack()).toBe(true)        // App まで戻るが伝わらない＝画面は閉じない
    await nextTick()
    expect(track()).toContain('calc(0%')              // 分類先の選択へ戻る
    expect(host.querySelector('.af')).toBeTruthy()
  })

  it('品目一覧からの戻るは何度でもスライドで返る', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()

    for (let i = 0; i < 3; i++) {
      // 分類先を選び直して品目一覧へ入る → 戻る、を繰り返す
      await click(host.querySelector('.af-gcard'))
      expect(track()).toContain('calc(-50%')
      expect(consumeInnerLayerBack()).toBe(true)
      await nextTick()
      expect(track()).toContain('calc(0%')
    }
  })

  it('分類先の一覧まで戻ったら、次の戻るは開いた元の画面へ返す', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    consumeInnerLayerBack()                           // 品目一覧 → 分類先の一覧
    await nextTick()
    expect(consumeInnerLayerBack()).toBe(false)       // App へ渡す＝この画面を閉じる
  })

  it('モーダルが開いていれば、そちらを先に閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    await click(host.querySelector('.af-confirm'))    // 「確認」＝振り分け済みシート
    expect(host.querySelector('.af-sheet')).toBeTruthy()

    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(host.querySelector('.af-sheet')).toBeNull()
    expect(track()).toContain('calc(-50%')            // 品目一覧には留まる
  })

  it('ヘッダーの「‹ 分類一覧」も同じ戻り方をする', async () => {
    await mount()
    await click(host.querySelector('.af-back'))
    expect(track()).toContain('calc(0%')
  })
})

describe('AxisAssignFocus — 使っていない品目の見分け', () => {
  it('直近の棚卸で入力の無い品目に「未使用」の印がつく', async () => {
    await mount()
    const marked = rows().filter(r => r.querySelector('.af-item-unused'))
      .map(r => r.getAttribute('data-item'))
    expect(marked.sort()).toEqual(['レタス', '豚バラ'].sort())   // トマトは入力済み
  })

  it('「未使用のみ」で隠す候補だけに絞れる', async () => {
    await mount()
    await click(chip('未使用のみ'))
    await openAllGenres()
    expect(rowNames().sort()).toEqual(['レタス', '豚バラ'].sort())
  })

  it('「前回入力のみ」と「未使用のみ」は同時に立たない', async () => {
    await mount()
    await click(chip('前回入力のみ'))
    await openAllGenres()
    expect(rowNames()).toEqual(['トマト'])

    await click(chip('未使用のみ'))
    await openAllGenres()
    expect(chip('前回入力のみ').className).not.toContain('on')
    expect(rowNames().sort()).toEqual(['レタス', '豚バラ'].sort())
  })
})
