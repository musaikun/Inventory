// 分類先の操作をホイールへ移したことの回帰。
//
// 分類先が20件近くある運用では、一覧から選ぶ形だと選ぶたびに品目一覧との往復が要る。
// 縦に回すホイールにして往復を無くし、いま何に振り分けているかを常に画面へ出す。
// 1枚だけの追加・削除はホイール隣のレール、順番を含めたまとめ直しは ⚙ の一括編集。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let cfg
const originalElementsFromPoint = document.elementsFromPoint
const originalMatchMedia = globalThis.matchMedia

async function mount() {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Focus, { initialAxis: 0 }) })
  app.mount(host)
  await nextTick()
  return host
}

const cards    = () => [...host.querySelectorAll('.af-gcard .af-gname')].map(e => e.textContent.trim())
const centre   = () => host.querySelector('.af-gcard.on .af-gname')?.textContent.trim()
const rail     = sel => host.querySelector(`.af-rail-btn${sel}`)
const dialog   = () => host.querySelector('.af-dialog')
const editPage = () => host.querySelector('.af-edit')
const editRows = () => [...host.querySelectorAll('.af-erow .af-ename')].map(e => e.textContent.trim())
const undoBar  = () => host.querySelector('.af-undobar')
const pointer  = (el, type, x, y, pointerId = 1) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    isPrimary: { configurable: true, value: true },
  })
  return el.dispatchEvent(event)
}
const key = (el, value) => el.dispatchEvent(new KeyboardEvent('keydown', {
  bubbles: true, cancelable: true, key: value,
}))

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
async function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await nextTick()
}
// 慣性で止まるまでフレームを送る（ホイールは rAF で減速して枠へ吸い付く）
async function settle(n = 60) {
  for (let i = 0; i < n; i++) {
    await new Promise(r => (globalThis.requestAnimationFrame || setTimeout)(r))
    await nextTick()
  }
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
  if (originalElementsFromPoint) {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: originalElementsFromPoint,
    })
  } else {
    delete document.elementsFromPoint
  }
  if (originalMatchMedia) {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true, value: originalMatchMedia,
    })
  } else {
    delete globalThis.matchMedia
  }
})

describe('AxisAssignFocus — 分類先ホイール', () => {
  it('分類先がホイールに並び、中央の1枚が振り分け先になる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    expect(new Set(cards())).toEqual(new Set(['冷蔵庫', '棚', '冷凍庫']))
    expect(centre()).toBe('冷蔵庫')
  })

  it('先頭の上に末尾が続き、触れた側へ一周できる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()

    const previous = host.querySelector('.af-gcard[data-slot="-1"]')
    expect(previous?.querySelector('.af-gname').textContent.trim()).toBe('冷凍庫')
    await click(previous)
    await settle()
    expect(centre()).toBe('冷凍庫')

    const firstAgain = host.querySelector('.af-gcard[data-slot="0"]')
    expect(firstAgain?.querySelector('.af-gname').textContent.trim()).toBe('冷蔵庫')
    await click(firstAgain)
    await settle()
    expect(centre()).toBe('冷蔵庫')
  })

  it('Pointer Captureでclick先がstageになっても、押したカードまで回る', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const stage = host.querySelector('.af-stage')
    const previous = host.querySelector('.af-gcard[data-slot="-1"]')

    // 実ブラウザではcapture後のpointerup/clickがstageへretargetされる。
    pointer(previous, 'pointerdown', 40, 72, 7)
    pointer(stage, 'pointerup', 40, 72, 7)
    await settle()

    expect(centre()).toBe('冷凍庫')
  })

  it('先頭から下へ回しても端で止まらず末尾へつながる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const stage = host.querySelector('.af-stage')

    pointer(stage, 'pointerdown', 40, 100)
    pointer(stage, 'pointermove', 40, 154)
    await nextTick()

    expect(centre()).toBe('冷凍庫')
  })

  it('分類先が1件だけなら同じカードを複製しない', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    expect(cards()).toEqual(['冷蔵庫'])
  })

  it('分類先が2件でも前後が途切れず、反対側の1件へ回れる', async () => {
    for (const g of ['冷蔵庫', '棚']) cfg.addAxisGroup(0, g)
    await mount()

    expect(host.querySelector('.af-gcard[data-slot="-1"] .af-gname').textContent.trim()).toBe('棚')
    expect(host.querySelector('.af-gcard[data-slot="1"] .af-gname').textContent.trim()).toBe('棚')
    await click(host.querySelector('.af-gcard[data-slot="1"]'))
    await settle()
    expect(centre()).toBe('棚')
  })

  it('中央以外の循環カードは読み上げから外し、上下キーでも循環できる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const stage = host.querySelector('.af-stage')

    expect(stage.tabIndex).toBe(0)
    expect([...host.querySelectorAll('.af-gcard:not(.on)')]
      .every(card => card.getAttribute('aria-hidden') === 'true')).toBe(true)
    key(stage, 'ArrowUp')
    await settle()
    expect(centre()).toBe('冷凍庫')
  })

  it('両方向へ複数周回した後も、中央表示と品目の保存先が一致する', async () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: vi.fn(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      })),
    })
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const stage = host.querySelector('.af-stage')

    for (let i = 0; i < 7; i++) key(stage, 'ArrowDown')
    await nextTick()
    expect(centre()).toBe('棚')

    for (let i = 0; i < 8; i++) key(stage, 'ArrowUp')
    await nextTick()
    expect(centre()).toBe('冷凍庫')

    for (const head of [...host.querySelectorAll('.af-cat-head')]) await click(head)
    const item = host.querySelector('.af-item')
    const itemName = item.dataset.item
    await click(item)

    expect(centre()).toBe('冷凍庫')
    expect(cfg.config.tagsA[itemName]).toContain('冷凍庫')
  })

  it('中央以外のカードをタップすると、そこまで回る（1枚ずつ送らせない）', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const far = [...host.querySelectorAll('.af-gcard')]
      .find(c => c.querySelector('.af-gname').textContent.trim() === '冷凍庫')
    await click(far)
    await settle()
    expect(centre()).toBe('冷凍庫')
  })

  it('分類先が無いときは作り方を案内する', async () => {
    await mount()
    expect(host.querySelector('.af-empty').textContent).toContain('「＋」で分類先を作って')
  })

  it('カードごとの ✎ / 🗑 を持たない（行タップとの取り違えを起こさない）', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    expect(host.querySelector('.af-gcard .af-gicon')).toBeNull()
    expect(host.querySelectorAll('.af-rail-btn').length).toBe(3)   // ＋ / ⚙ / 🗑
  })

  it('領域を畳んでも補助表示をDOMから抜かず、同じ画面のまま滑らかに縮める', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const wheel = host.querySelector('.af-wheel')
    const marker = host.querySelector('.af-marker')
    const fades = [...host.querySelectorAll('.af-fade')]

    expect(parseFloat(getComputedStyle(wheel).transitionDuration)).toBeGreaterThanOrEqual(0.4)
    pointer(host.querySelector('.af-list'), 'pointerdown', 40, 400)
    await nextTick()
    expect(wheel.classList.contains('band')).toBe(false)
    await click(host.querySelector('.af-list'))

    expect(wheel.classList.contains('band')).toBe(true)
    expect(wheel.style.height).toBe('56px')
    expect(host.querySelector('.af-marker')).toBe(marker)
    expect([...host.querySelectorAll('.af-fade')]).toEqual(fades)
  })

  it('回転中に品目へ触れたら中央へ確定し、表示と保存先をずらさない', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    for (const head of [...host.querySelectorAll('.af-cat-head')]) await click(head)
    const item = host.querySelector('.af-item')
    const itemName = item.dataset.item
    const far = host.querySelector('.af-gcard[data-slot="2"]')
    await click(far)
    await settle(1)

    pointer(host.querySelector('.af-list'), 'pointerdown', 40, 400)
    await nextTick()
    const destination = centre()
    await click(item)
    await settle()

    expect(centre()).toBe(destination)
    expect(cfg.config.tagsA[itemName]).toContain(destination)
  })

  it('回転中に中央の件数を押しても対象を固定して振り分け済みを開く', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    await mount()
    await click(host.querySelector('.af-gcard[data-slot="2"]'))
    await settle(1)
    const selected = centre()
    const count = host.querySelector('.af-gcard.on .af-gcount')

    pointer(count, 'pointerdown', 220, 98)
    pointer(count, 'pointerup', 220, 98)
    await click(count)
    await settle()

    expect(centre()).toBe(selected)
    expect(host.querySelector('.af-sheet-title').textContent).toContain(selected)
  })

  // User報告 2026-09-04:「振り分け件数をタップすると、開くものと開かないものがある」。
  // 慣性で回っている最中は、指が着いた瞬間にはもう別のカードが中央になっている。
  // 人は**見えている数字**を狙って押しているのに、判定が「いま中央か」だったので、
  // 押した数字とは無関係に外れていた（clickも、押した要素と離した要素が違うと出ない）。
  it('中央でないカードの件数を押しても、その分類先の振り分け済みが開く', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    cfg.addItemToGroup(0, 'トマト', '棚')
    await mount()
    await settle()

    const card = host.querySelector('.af-gcard[data-slot="1"]')
    expect(card.classList.contains('on'), '隣のカードであること').toBe(false)
    const name = card.querySelector('.af-gname').textContent.trim()
    const count = card.querySelector('.af-gcount')

    // 押して離すだけ（click は出ない前提で pointerup が確定させる）
    pointer(count, 'pointerdown', 220, 98)
    pointer(count, 'pointerup', 220, 98)
    await settle()

    expect(host.querySelector('.af-sheet-title').textContent).toContain(name)
    expect(centre(), '押した分類先が中央に来る').toBe(name)
    expect([...host.querySelectorAll('.af-sheet-item-name')].map(e => e.textContent.trim()))
      .toEqual(['トマト'])
  })

  it('件数の上から指を滑らせたら、シートは開かずにホイールが回る', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    await settle()
    const before = centre()
    const count = host.querySelector('.af-gcard.on .af-gcount')

    pointer(count, 'pointerdown', 220, 120)
    for (let i = 1; i <= 6; i++) pointer(count, 'pointermove', 220, 120 - i * 12)
    pointer(count, 'pointerup', 220, 48)
    await settle()

    expect(host.querySelector('.af-sheet')).toBeNull()
    expect(centre()).not.toBe(before)
  })

  it('動きを減らす設定では自動回転と領域変更を即時にする', async () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: vi.fn(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      })),
    })
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const stage = host.querySelector('.af-stage')

    pointer(host.querySelector('.af-gcard[data-slot="-1"]'), 'pointerdown', 40, 72)
    pointer(stage, 'pointerup', 40, 72)
    await nextTick()

    expect(centre()).toBe('冷凍庫')
    expect(host.querySelector('.af-wheel').style.transitionDuration).toBe('0ms')
  })
})

describe('AxisAssignFocus — レールから1枚だけ足す・消す', () => {
  it('＋ で足すと、その1枚が中央に来る', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    await click(rail(''))                       // ＋ は最初のボタン
    await type(host.querySelector('.af-dialog-input'), '棚')
    await click(host.querySelector('.af-dialog-ok'))
    await settle()

    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚'])
    expect(centre()).toBe('棚')
  })

  it('同名は追加せず理由を出す', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    await click(rail(''))
    await type(host.querySelector('.af-dialog-input'), '冷蔵庫')
    await click(host.querySelector('.af-dialog-ok'))
    expect(dialog()).toBeTruthy()               // 閉じない
    expect(host.querySelector('.af-dialog-err').textContent).toContain('既に使われています')
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫'])
  })

  it('🗑 は確認してから消し、割り当てごと戻せる', async () => {
    for (const g of ['冷蔵庫', '棚']) cfg.addAxisGroup(0, g)
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    await mount()

    await click(rail('.del'))
    expect(dialog().textContent).toContain('1件の割り当ても外れます')
    await click(host.querySelector('.af-dialog-cancel'))
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚'])   // 取り消したら消えない

    await click(rail('.del'))
    await click(host.querySelector('.af-dialog-ok'))
    expect(cfg.config.axisGroupsA).toEqual(['棚'])
    expect(cfg.config.tagsA['トマト']).toBeUndefined()

    await click(undoBar().querySelector('.af-undo-btn'))
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚'])   // 位置も戻る
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫'])     // 割り当ても戻る
  })

  it('末尾を消したら循環上の次である先頭を中央にする', async () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: vi.fn(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      })),
    })
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    await click(host.querySelector('.af-gcard[data-slot="2"]'))
    expect(centre()).toBe('冷凍庫')

    await click(rail('.del'))
    await click(host.querySelector('.af-dialog-ok'))

    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚'])
    expect(centre()).toBe('冷蔵庫')
  })
})

describe('AxisAssignFocus — ⚙ の一括編集', () => {
  it('⚙ で開き、分類先が一覧になる', async () => {
    for (const g of ['冷蔵庫', '棚']) cfg.addAxisGroup(0, g)
    await mount()
    expect(editPage().classList.contains('on')).toBe(false)
    expect(editPage().hasAttribute('inert')).toBe(true)
    expect(editPage().getAttribute('aria-hidden')).toBe('true')

    await click(rail('.gear'))
    expect(editPage().classList.contains('on')).toBe(true)
    expect(editPage().hasAttribute('inert')).toBe(false)
    expect(editPage().getAttribute('aria-hidden')).toBe('false')
    expect(document.activeElement).toBe(host.querySelector('.af-edit-done'))
    expect(editRows()).toEqual(['冷蔵庫', '棚'])

    const lastControl = host.querySelector('.af-edit-add')
    lastControl.focus()
    key(lastControl, 'Tab')
    expect(document.activeElement).toBe(host.querySelector('.af-edit-done'))

    await click(host.querySelector('.af-edit-done'))
    expect(document.activeElement).toBe(rail('.gear'))
  })

  it('割り当てだけで現れているグループも、開いた時点で並べ替えの対象にする', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.setItemTag('トマト', 0, '棚')            // 定義リストに無いグループ
    await mount()
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫'])

    await click(rail('.gear'))
    // 定義側へ取り込む。setAxisGroupOrder は定義済みの並べ替えしか受け付けないため
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚'])
    expect(editRows()).toEqual(['冷蔵庫', '棚'])
  })

  it('一覧から名前を変えられる', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    await mount()
    await click(rail('.gear'))
    await click(host.querySelector('.af-erow .af-ebtn'))          // ✎
    await type(host.querySelector('.af-dialog-input'), '冷蔵庫1')
    await click(host.querySelector('.af-dialog-ok'))

    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫1'])
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫1'])       // 割り当ても追従
  })

  it('一覧から消せる', async () => {
    for (const g of ['冷蔵庫', '棚']) cfg.addAxisGroup(0, g)
    await mount()
    await click(rail('.gear'))
    await click(host.querySelector('.af-erow .af-ebtn.del'))
    await click(host.querySelector('.af-dialog-ok'))
    expect(cfg.config.axisGroupsA).toEqual(['棚'])
  })

  it('完了で閉じ、見ていた分類先の前へ戻る', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    const far = [...host.querySelectorAll('.af-gcard')]
      .find(c => c.querySelector('.af-gname').textContent.trim() === '棚')
    await click(far)
    await settle()
    expect(centre()).toBe('棚')

    await click(rail('.gear'))
    await click(host.querySelector('.af-edit-done'))
    expect(editPage().classList.contains('on')).toBe(false)
    expect(centre()).toBe('棚')
  })

  it.each([
    { label: '下へ動かすと間のカードが上へ流れる', drag: 0, over: 1, y: 100, delta: 60, order: ['棚', '冷蔵庫', '冷凍庫'] },
    { label: '上へ動かすと間のカードが下へ流れる', drag: 2, over: 1, y: 70, delta: -60, order: ['冷蔵庫', '冷凍庫', '棚'] },
  ])('$label', async ({ drag, over, y, delta, order }) => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    await click(rail('.gear'))

    const list = host.querySelector('.af-edit-list')
    const rows = [...host.querySelectorAll('.af-erow')]
    list.getBoundingClientRect = () => ({ top: -200, bottom: 800, height: 1000 })
    for (const row of rows) {
      row.getBoundingClientRect = () => {
        const i = [...list.children].indexOf(row)
        return { top: i * 60, bottom: i * 60 + 56, height: 56 }
      }
      row.animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }))
    }
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: vi.fn(() => [rows[over]]),
    })

    pointer(rows[drag].querySelector('.af-ehandle'), 'pointerdown', 20, drag * 60 + 28)
    pointer(list, 'pointermove', 20, y)

    const shifted = rows[over === drag ? 0 : 1]
    expect(shifted.animate).toHaveBeenCalledWith(
      [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
      expect.objectContaining({ duration: 620 })
    )
    // ドラッグ中はDOMだけを動かし、Vueの配列はpointerupまで書き換えない。
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '棚', '冷凍庫'])

    pointer(list, 'pointerup', 20, y)
    await nextTick()
    expect(cfg.config.axisGroupsA).toEqual(order)
    expect(editRows()).toEqual(order)
  })

  it('流れている途中のカードをすぐ掴み直しても、前の補間を止めて指へ追従できる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    await click(rail('.gear'))
    const list = host.querySelector('.af-edit-list')
    const rows = [...host.querySelectorAll('.af-erow')]
    list.getBoundingClientRect = () => ({ top: -200, bottom: 800, height: 1000 })
    for (const row of rows) {
      row.getBoundingClientRect = () => {
        const i = [...list.children].indexOf(row)
        return { top: i * 60, bottom: i * 60 + 56, height: 56 }
      }
      row.animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }))
    }
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: vi.fn(() => [rows[1]]),
    })

    pointer(rows[0].querySelector('.af-ehandle'), 'pointerdown', 20, 28, 21)
    pointer(list, 'pointermove', 20, 100, 21)
    const previousShift = rows[1].animate.mock.results[0].value
    pointer(list, 'pointerup', 20, 100, 21)

    pointer(rows[1].querySelector('.af-ehandle'), 'pointerdown', 20, 28, 22)
    expect(previousShift.cancel).toHaveBeenCalledOnce()
    pointer(rows[1].querySelector('.af-ehandle'), 'lostpointercapture', 20, 28, 22)
  })

  it('つまみ以外を押しても並べ替えを開始しない', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    await click(rail('.gear'))
    const row = host.querySelector('.af-erow')

    pointer(row.querySelector('.af-ename'), 'pointerdown', 80, 28)

    expect(row.classList.contains('drag')).toBe(false)
  })

  it('別の指のmove/upは無視し、captureを失ったらドラッグ状態を片付ける', async () => {
    for (const g of ['冷蔵庫', '棚']) cfg.addAxisGroup(0, g)
    await mount()
    await click(rail('.gear'))
    const list = host.querySelector('.af-edit-list')
    const row = host.querySelector('.af-erow')
    const handle = row.querySelector('.af-ehandle')

    pointer(handle, 'pointerdown', 20, 28, 11)
    pointer(list, 'pointermove', 20, 100, 12)
    pointer(list, 'pointerup', 20, 100, 12)
    expect(row.classList.contains('drag')).toBe(true)
    expect(row.style.transform).toBe('')

    pointer(handle, 'lostpointercapture', 20, 28, 11)
    expect(row.classList.contains('drag')).toBe(false)
    expect(list.classList.contains('dragging')).toBe(false)
  })

  it('並べ替えつまみは上下矢印キーでも移動できる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    await click(rail('.gear'))
    const handle = host.querySelector('.af-ehandle')
    handle.focus()

    key(handle, 'ArrowDown')
    await nextTick()

    expect(cfg.config.axisGroupsA).toEqual(['棚', '冷蔵庫', '冷凍庫'])
    expect(editRows()).toEqual(['棚', '冷蔵庫', '冷凍庫'])
    expect(document.activeElement.getAttribute('aria-label')).toContain('冷蔵庫')
  })
})

describe('AxisAssignFocus — 戻るの段', () => {
  it('上から順に1段だけ畳み、最後は App へ渡す', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()

    await click(rail('.gear'))                  // 一括編集を開く
    await click(rail(''))                       // その上に「追加」を開く
    expect(dialog()).toBeTruthy()

    expect(consumeInnerLayerBack()).toBe(true)  // まず追加を閉じる
    await nextTick()
    expect(dialog()).toBeNull()
    expect(editPage().classList.contains('on')).toBe(true)

    expect(consumeInnerLayerBack()).toBe(true)  // 次に一括編集を閉じる
    await nextTick()
    expect(editPage().classList.contains('on')).toBe(false)

    expect(consumeInnerLayerBack()).toBe(false) // 畳むものが無ければ画面を閉じる
  })
})
