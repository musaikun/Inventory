// 振り分け済みシート（中央カードの件数 / 分類先管理の件数チップから開く）。
//   - 件数はタップで開く（長押しさせない）
//   - 中の品目を、分類先の並べ替えと同じ手順（カードを長押し → 上下へ運ぶ）で並べ替えられる
//   - 品目は分類先より数が多いので、上から順にタップするだけの簡易並べ替えも持つ
// 並びの保存先は config.order。棚卸・発注カードの「分類先の中の並び」はこれがそのまま出る。
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

const pointer = (el, type, x, y, pointerId = 1) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    isPrimary: { configurable: true, value: true },
  })
  return el.dispatchEvent(event)
}
const macrotask = () => new Promise(r => setTimeout(r, 0))
async function click(el) {
  // 押す相手が居ないまま進むと、失敗が「undefined.dispatchEvent」になって
  // どの導線が欠けたのか分からなくなる。ここで何を押そうとしたかを残す。
  if (!el) throw new Error('押そうとした要素が見つかりません')
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await macrotask()
}
/** 条件が満たされるまで待つ。満たされないまま尽きたら、何を待っていたかを出して落ちる。
 *  決まった回数の tick で待つと、遅いCIでは描き切る前に次の操作へ進んでしまう。 */
async function waitFor(get, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const v = get()
    if (v) return v
    await nextTick()
    await macrotask()
  }
  throw new Error(`待っても現れませんでした: ${label}`)
}
const HOLD_WAIT_MS = 300
const grab = async (el, x, y, pointerId = 1) => {
  pointer(el, 'pointerdown', x, y, pointerId)
  await new Promise(r => setTimeout(r, HOLD_WAIT_MS))
}

const sheet     = () => host.querySelector('.af-sheet')
const sheetRows = () => [...host.querySelectorAll('.af-sheet-item')]
const sheetNames = () => sheetRows().map(r => r.getAttribute('data-item'))
const rowOf     = name => sheetRows().find(r => r.getAttribute('data-item') === name)
const btn       = label => [...host.querySelectorAll('.af-sheet button')]
  .find(b => b.textContent.trim().startsWith(label))
const centreCount = () => host.querySelector('.af-gcard.on .af-gcount')

// 中央カードの件数を「ふつうのタップ」で押す（指はほぼ動かない）
async function tapCount() {
  const el = centreCount()
  pointer(el, 'pointerdown', 220, 98, 5)
  pointer(el, 'pointerup', 220, 98, 5)
  await nextTick()
}
// 開いたうえで、次の操作ができる状態にする。
// 実機では指を離した後の click が1回降ってくるので、ここでも同じように1回出す
// （これが食べられて、以降は普通に操作できる）。
async function openSheet() {
  await tapCount()
  await click(host.querySelector('.af-modal'))
}
// 並び替えそのものを見るテスト用。開き方（指のタップと ghost click）はここの主題ではないので、
// ジェスチャを経由しない入口＝分類先管理の件数チップから開く。
async function openSheetViaChip(group = '冷蔵庫') {
  await click(host.querySelector('.af-rail-btn.gear'))
  const chip = [...host.querySelectorAll('.af-erow')]
    .find(r => r.querySelector('.af-ename').textContent.trim() === group)
    .querySelector('.af-ecount')
  await click(chip)
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  for (const n of ['トマト', 'レタス', '人参', '玉ねぎ']) cfg.addItem(n, 100, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  cfg.setAxisName(0, '場所')
  cfg.addAxisGroup(0, '冷蔵庫')
  cfg.addAxisGroup(0, '常温棚')
  for (const n of ['トマト', 'レタス', '人参']) cfg.addItemToGroup(0, n, '冷蔵庫')
  cfg.addItemToGroup(0, '豚バラ', '常温棚')
  await nextTick()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('振り分け済みシート — 開き方', () => {
  it('中央カードの件数はタップで開く（長押しさせない）', async () => {
    await mount()
    expect(sheet()).toBeNull()
    await tapCount()
    expect(sheet()).toBeTruthy()
    expect(sheetNames()).toEqual(['トマト', 'レタス', '人参'])
  })

  // 開いたのと同じ指の click が、開いたばかりのシートの上に降ってくる。
  // 背景に当たれば即閉じ、行に当たれば別の品目へ飛ぶ。どちらも「タップでは反応しない」に見える。
  // 長押しだと端末が click を出さないので、そちらだけ動いているように見えていた。
  it('開いた直後に降ってくる click で閉じない', async () => {
    await mount()
    await tapCount()
    await click(host.querySelector('.af-modal'))     // 同じタップの click が背景に落ちる
    expect(sheet()).toBeTruthy()
  })

  it('開いた直後の click は中の行にも効かせない', async () => {
    await mount()
    await tapCount()
    await click(rowOf('トマト').querySelector('.af-sheet-item-name'))
    expect(sheet()).toBeTruthy()                      // locate で閉じて一覧へ飛んでいない
  })

  it('ghost click を食べた後は、背景のタップで閉じる', async () => {
    await mount()
    await openSheet()
    await click(host.querySelector('.af-modal'))
    expect(sheet()).toBeNull()
  })

  // 食べるのは1回だけ。時間の窓で塞ぐと、その間は本当の操作まで死ぬ。
  it('食べるのは1回だけで、次の click はすぐ効く', async () => {
    await mount()
    await tapCount()
    await click(host.querySelector('.af-modal'))   // ghost
    expect(sheet()).toBeTruthy()
    await click(host.querySelector('.af-modal'))   // 本当のタップ
    expect(sheet()).toBeNull()
  })

  // 件数チップ（分類先管理）からは本物の click で開くので、食べる相手がいない
  it('管理の件数チップから開いたときは、次の click を食べない', async () => {
    await mount()
    await click(host.querySelector('.af-rail-btn.gear'))
    const chip = [...host.querySelectorAll('.af-erow')]
      .find(r => r.querySelector('.af-ename').textContent.trim() === '常温棚')
      .querySelector('.af-ecount')
    await click(chip)
    expect(sheet()).toBeTruthy()
    await click(host.querySelector('.af-modal'))
    expect(sheet()).toBeNull()
  })

  it('指が少し動いてもタップとして開く（実際の指は数px動く）', async () => {
    await mount()
    const el = centreCount()
    pointer(el, 'pointerdown', 220, 98, 6)
    pointer(el, 'pointermove', 220, 104, 6)     // 6px
    pointer(el, 'pointerup', 220, 104, 6)
    await nextTick()
    expect(sheet()).toBeTruthy()
  })

  it('本当に回したときは開かない（回転として扱う）', async () => {
    await mount()
    const el = centreCount()
    pointer(el, 'pointerdown', 220, 98, 7)
    pointer(el, 'pointermove', 220, 160, 7)     // 62px = 回した
    pointer(el, 'pointerup', 220, 160, 7)
    await nextTick()
    expect(sheet()).toBeNull()
  })

  it('分類先管理の件数チップからも開ける', async () => {
    await mount()
    await click(host.querySelector('.af-rail-btn.gear'))
    const chip = [...host.querySelectorAll('.af-erow')]
      .find(r => r.querySelector('.af-ename').textContent.trim() === '常温棚')
      .querySelector('.af-ecount')
    await click(chip)
    expect(sheet()).toBeTruthy()
    expect(sheetNames()).toEqual(['豚バラ'])
  })
})

describe('振り分け済みシート — 並び替え', () => {
  it('既定では並び替えモードではなく、確認の導線が出ている', async () => {
    await mount()
    await openSheetViaChip()
    expect(host.querySelector('.af-sheet-handle')).toBeNull()
    expect(rowOf('トマト').querySelector('.af-sheet-off')).toBeTruthy()
  })

  it('並び替えに入るとつまみが出て、外す・確認は引っ込む', async () => {
    await mount()
    await openSheetViaChip()
    await click(btn('⇅ 並び替え'))
    await waitFor(() => host.querySelector('.af-sheet-handle'), '並び替えモード')
    expect(host.querySelectorAll('.af-sheet-handle').length).toBe(3)
    expect(rowOf('トマト').querySelector('.af-sheet-off')).toBeNull()
  })

  it('カードを長押しして運ぶと config.order のその分類先の位置だけが入れ替わる', async () => {
    await mount()
    await openSheetViaChip()
    await click(btn('⇅ 並び替え'))
    await waitFor(() => host.querySelector('.af-sheet-handle'), '並び替えモード')
    const list = host.querySelector('.af-sheet-list')
    list.setPointerCapture = vi.fn()
    list.getBoundingClientRect = () => ({ top: -200, bottom: 800, height: 1000 })
    const rows = sheetRows()
    for (const row of rows) {
      row.getBoundingClientRect = () => {
        const i = [...list.children].indexOf(row)
        return { top: i * 60, bottom: i * 60 + 56, height: 56 }
      }
      row.animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }))
    }
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: vi.fn(() => [rows[2]]),
    })

    await grab(rows[0], 40, 28, 11)          // トマトを掴んで
    pointer(list, 'pointermove', 40, 160, 11) // 人参の下まで運ぶ
    pointer(list, 'pointerup', 40, 160, 11)
    await nextTick()

    expect(cfg.config.order.filter(n => ['トマト', 'レタス', '人参'].includes(n)))
      .toEqual(['レタス', '人参', 'トマト'])
    // その分類先に居ない品目は1つも動かない
    expect(cfg.config.order).toContain('豚バラ')
    expect(cfg.config.order.length).toBe(5)
  })

  it('掴むまでの間に指が流れたら並べ替えない', async () => {
    await mount()
    await openSheetViaChip()
    await click(btn('⇅ 並び替え'))
    await waitFor(() => host.querySelector('.af-sheet-handle'), '並び替えモード')
    const list = host.querySelector('.af-sheet-list')
    list.setPointerCapture = vi.fn()
    const rows = sheetRows()

    pointer(rows[0], 'pointerdown', 40, 28, 12)
    pointer(list, 'pointermove', 40, 120, 12)
    await new Promise(r => setTimeout(r, HOLD_WAIT_MS))
    expect(rows[0].classList.contains('drag')).toBe(false)
    expect(list.setPointerCapture).not.toHaveBeenCalled()
  })
})

describe('振り分け済みシート — タップ順の簡易並び替え', () => {
  async function enterTapOrder() {
    await mount()
    await openSheetViaChip()
    await click(btn('⇅ 並び替え'))
    await waitFor(() => host.querySelector('.af-sheet-tap'), '並び替えモード')
    await click(btn('① タップ順で並べる'))
    await waitFor(() => host.querySelector('.af-sheet-apply'), 'タップ順モード')
  }
  // タップして番号が付くまでを1つの手順にする（付かないまま先へ進むと、
  // 失敗が「並びが変わらない」になって、どこで落ちたのか読めない）
  async function tapPick(name) {
    await click(rowOf(name).querySelector('.af-sheet-item-name'))
    await waitFor(
      () => rowOf(name).querySelector('.af-sheet-no')?.textContent.trim() !== '–',
      `${name} に番号が付く`,
    )
  }

  it('タップした順に番号が付く', async () => {
    await enterTapOrder()
    await click(rowOf('人参').querySelector('.af-sheet-item-name'))
    await click(rowOf('トマト').querySelector('.af-sheet-item-name'))
    expect(rowOf('人参').querySelector('.af-sheet-no').textContent.trim()).toBe('1')
    expect(rowOf('トマト').querySelector('.af-sheet-no').textContent.trim()).toBe('2')
    expect(rowOf('レタス').querySelector('.af-sheet-no').textContent.trim()).toBe('–')
  })

  it('もう一度タップで外れ、後ろの番号が繰り上がる', async () => {
    await enterTapOrder()
    for (const n of ['人参', 'トマト', 'レタス']) {
      await click(rowOf(n).querySelector('.af-sheet-item-name'))
    }
    await click(rowOf('トマト').querySelector('.af-sheet-item-name'))   // 2番目を外す
    expect(rowOf('人参').querySelector('.af-sheet-no').textContent.trim()).toBe('1')
    expect(rowOf('レタス').querySelector('.af-sheet-no').textContent.trim()).toBe('2')
    expect(rowOf('トマト').querySelector('.af-sheet-no').textContent.trim()).toBe('–')
  })

  it('確定するとタップした順が上、触らなかったものは今の順で後ろへ', async () => {
    await enterTapOrder()
    await tapPick('人参')
    await click(btn('この順で確定'))

    expect(cfg.config.order.filter(n => ['トマト', 'レタス', '人参'].includes(n)))
      .toEqual(['人参', 'トマト', 'レタス'])
    expect(sheetNames()).toEqual(['人参', 'トマト', 'レタス'])
  })

  it('1件も選ばないうちは確定できない', async () => {
    await enterTapOrder()
    expect(btn('この順で確定').disabled).toBe(true)
  })

  it('確定した並びは元に戻せる', async () => {
    await enterTapOrder()
    await tapPick('人参')
    await click(btn('この順で確定'))
    expect(sheetNames()).toEqual(['人参', 'トマト', 'レタス'])

    await click(host.querySelector('.af-undobar .af-undo-btn'))
    expect(cfg.config.order.filter(n => ['トマト', 'レタス', '人参'].includes(n)))
      .toEqual(['トマト', 'レタス', '人参'])
  })

  it('戻るは、シートを閉じる前にタップ順・並び替えを順に畳む', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await enterTapOrder()

    expect(consumeInnerLayerBack()).toBe(true)   // タップ順を畳む
    await nextTick()
    expect(host.querySelector('.af-sheet-no')).toBeNull()
    expect(host.querySelector('.af-sheet-handle')).toBeTruthy()

    expect(consumeInnerLayerBack()).toBe(true)   // 並び替えを畳む
    await nextTick()
    expect(host.querySelector('.af-sheet-handle')).toBeNull()
    expect(sheet()).toBeTruthy()

    expect(consumeInnerLayerBack()).toBe(true)   // シートを閉じる
    await nextTick()
    expect(sheet()).toBeNull()
  })
})
