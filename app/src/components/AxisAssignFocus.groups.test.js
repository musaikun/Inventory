// 分類先（グループ）を増やす・消す導線の回帰。
// 追加: ヘッダーの「＋ グループ」→ カード一覧の下の「＋」→モーダル。
//   ヘッダーに置くと、カードを見ながら増やす動作から視線が離れる。
//   また常時開く入力バーは、1件でもあると一覧の上を占め続けていた。
// 削除: ヘッダーの「編集」モード → 各カードに常設の 🗑。
//   1つ消すために画面全体のモードを切り替えるのは、操作と対象が離れている。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let cfg

async function mount() {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Focus, { initialAxis: 0 }) })
  app.mount(host)
  await nextTick()
  return host
}

const head = () => host.querySelector('.af-head')
const pane = () => host.querySelector('.af-pane')
const addBtn = () => host.querySelector('.af-gadd-card')
const modal = () => host.querySelector('.af-gadd-sheet')
const input = () => host.querySelector('.af-gadd-input')
const okBtn = () => host.querySelector('.af-gadd-ok')
const cards = () => [...host.querySelectorAll('.af-gcard .af-gname')].map(e => e.textContent.trim())
const delBtns = () => [...host.querySelectorAll('.af-gcard .af-gdel')]
const undoBar = () => host.querySelector('.af-undobar')
const undoBtn = () => host.querySelector('.af-undo-btn')

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
// TransitionGroup は leave するカードを次フレームまで DOM に残すため、
// 削除後の見た目を見るときはフレームを送る。
async function flushFrames() {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => (globalThis.requestAnimationFrame || setTimeout)(r))
    await nextTick()
  }
}
async function type(value) {
  const el = input()
  el.value = value
  el.dispatchEvent(new Event('input'))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  cfg.setAxisName(0, '場所')
  await nextTick()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('AxisAssignFocus — 分類先の削除導線', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('ヘッダーに「編集」を持たない', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    const labels = [...head().querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels).not.toContain('編集')
    expect(labels).not.toContain('完了')
  })

  it('編集を押さずとも、はじめから各カードに🗑が出ている', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.addAxisGroup(0, '棚')
    await mount()
    expect(delBtns().length).toBe(2)
    expect(delBtns()[0].textContent.trim()).toBe('🗑')
  })

  it('🗑は確認してから消し、品目の割り当ても外す', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    await mount()

    vi.stubGlobal('confirm', vi.fn(() => false))
    await click(delBtns()[0])
    expect(cards()).toEqual(['冷蔵庫'])            // 取り消したら消えない

    vi.stubGlobal('confirm', vi.fn(() => true))
    await click(delBtns()[0])
    expect(cfg.config.axisGroupsA).toEqual([])
    expect(cfg.config.tagsA['トマト'] ?? []).not.toContain('冷蔵庫')   // 割り当ても外れる
    await flushFrames()
    expect(cards()).toEqual([])
  })

  it('消したあとに元へ戻せる。振り分け済みの品目も位置も一緒に戻る', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    cfg.addItemToGroup(0, 'トマト', '棚')
    cfg.addItemToGroup(0, '豚バラ', '棚')
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')      // 別グループの割り当ては巻き添えにしない
    await mount()

    vi.stubGlobal('confirm', vi.fn(() => true))
    await click(delBtns()[1])                      // 真ん中の「棚」を消す
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '冷凍庫'])
    expect(cfg.config.tagsA['豚バラ']).toBeUndefined()
    expect(undoBar().textContent).toContain('品目 2 件')

    await click(undoBtn())
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚', '冷凍庫'])   // 位置も戻る
    expect(cfg.config.tagsA['豚バラ']).toEqual(['棚'])                   // 振り分けも戻る
    expect(cfg.config.tagsA['トマト'].sort()).toEqual(['冷蔵庫', '棚'].sort())
    await flushFrames()
    expect(undoBar()).toBeNull()
    expect(cards()).toEqual(['冷蔵庫', '棚', '冷凍庫'])
  })

  it('振り分けていないグループでも戻せる', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    vi.stubGlobal('confirm', vi.fn(() => true))
    await click(delBtns()[0])
    expect(undoBar().textContent).not.toContain('品目')
    await click(undoBtn())
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫'])
    await flushFrames()
    expect(undoBar()).toBeNull()
  })

  it('✕で取り消しバーを畳むと、削除は確定したまま', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    vi.stubGlobal('confirm', vi.fn(() => true))
    await click(delBtns()[0])
    await click(host.querySelector('.af-undo-x'))
    await flushFrames()
    expect(undoBar()).toBeNull()
    expect(cfg.config.axisGroupsA).toEqual([])
  })

  it('🗑を押してもそのカードは選択されない（品目一覧へ進まない）', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.addAxisGroup(0, '棚')
    await mount()
    vi.stubGlobal('confirm', vi.fn(() => false))
    await click(delBtns()[0])
    expect(host.querySelector('.af-track').style.transform).toContain('calc(0%')   // -50% = 品目一覧へ移動
  })
})

describe('AxisAssignFocus — 分類先の追加導線', () => {
  it('ヘッダーに「＋ グループ」を持たない', async () => {
    await mount()
    const labels = [...head().querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels).not.toContain('＋ グループ')
  })

  it('「＋」はカード一覧の下にあり、常設の入力欄は出さない', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    expect(addBtn()).toBeTruthy()
    expect(input()).toBeNull()                       // 押すまで入力欄は無い

    const nodes = [...pane().querySelectorAll('.af-glist, .af-gadd-card')]
    expect(nodes[0].classList.contains('af-glist')).toBe(true)   // 一覧が先
    expect(nodes[1]).toBe(addBtn())                              // 「＋」はその下
  })

  it('「＋」→モーダルで名前を入れて登録するとカードが増える', async () => {
    await mount()
    expect(cards()).toEqual([])

    await click(addBtn())
    expect(modal()).toBeTruthy()

    await type('冷蔵庫')
    await click(okBtn())

    expect(cards()).toEqual(['冷蔵庫'])
    expect(cfg.config.axisGroupsA).toContain('冷蔵庫')
    expect(modal()).toBeNull()                       // 登録すると閉じる
  })

  it('空欄では登録できず、同名は登録せずに理由を出す', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()

    await click(addBtn())
    expect(okBtn().disabled).toBe(true)              // 空欄

    await type('冷蔵庫')
    await click(okBtn())
    expect(modal()).toBeTruthy()                     // 閉じない
    expect(host.querySelector('.af-gadd-err').textContent).toContain('既に使われています')
    expect(cards()).toEqual(['冷蔵庫'])
  })

  it('キャンセルで閉じ、入力は残さない', async () => {
    await mount()
    await click(addBtn())
    await type('棚')
    await click(host.querySelector('.af-gadd-cancel'))
    expect(modal()).toBeNull()
    expect(cards()).toEqual([])

    await click(addBtn())
    expect(input().value).toBe('')
  })

  it('戻る操作は画面ごとではなくモーダルだけを閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()

    await click(addBtn())
    expect(consumeInnerLayerBack()).toBe(true)     // 追加モーダルを消費
    await nextTick()
    expect(modal()).toBeNull()
    expect(host.querySelector('.af')).toBeTruthy() // 画面は残る

    expect(consumeInnerLayerBack()).toBe(false)    // 分類先の一覧では App へ渡す＝画面を閉じる
  })

  it('未作成のときは「下の「＋」」を案内する', async () => {
    await mount()
    expect(pane().querySelector('.af-empty').textContent).toContain('下の「＋」')
  })
})
