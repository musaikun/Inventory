// 分類先（グループ）を増やす導線を、ヘッダーの「＋ グループ」から
// カード一覧の下の「＋」→モーダルへ移したことの回帰。
// ヘッダーに置くと、カードを見ながら増やす動作から視線が離れる。
// また常時開く入力バーは、1件でもあると一覧の上を占め続けていた。
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

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
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
  cfg.setAxisName(0, '場所')
  await nextTick()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
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

    expect(consumeInnerLayerBack()).toBe(false)    // 何も無ければ App へ渡す
  })

  it('未作成のときは「下の「＋」」を案内する', async () => {
    await mount()
    expect(pane().querySelector('.af-empty').textContent).toContain('下の「＋」')
  })
})
