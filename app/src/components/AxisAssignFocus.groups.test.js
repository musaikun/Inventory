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
})

describe('AxisAssignFocus — 分類先ホイール', () => {
  it('分類先がホイールに並び、中央の1枚が振り分け先になる', async () => {
    for (const g of ['冷蔵庫', '棚', '冷凍庫']) cfg.addAxisGroup(0, g)
    await mount()
    expect(cards()).toEqual(['冷蔵庫', '棚', '冷凍庫'])
    expect(centre()).toBe('冷蔵庫')
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
})

describe('AxisAssignFocus — ⚙ の一括編集', () => {
  it('⚙ で開き、分類先が一覧になる', async () => {
    for (const g of ['冷蔵庫', '棚']) cfg.addAxisGroup(0, g)
    await mount()
    expect(editPage().classList.contains('on')).toBe(false)

    await click(rail('.gear'))
    expect(editPage().classList.contains('on')).toBe(true)
    expect(editRows()).toEqual(['冷蔵庫', '棚'])
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
