// 数量シートを1枚に収めたことの回帰。
//
// 打つ場所が動く不具合（2026-09-05 User報告・実機で289px自動スクロール）の原因は
// テンキーではなく、**低頻度の要素が1つずつ全幅の行を持っていた**こと。
// 見出し・あとで数える・変更履歴・ジャンルで約145px、iPhone SE2 の画面から
// テンキーを押し出していた。行を持たせず、品目名の隣とヒント行のチップへ集める。
//
// ここで守るのは「低頻度のものが行を占めていないこと」。高さそのものは jsdom では
// 測れないので、構造で押さえる。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props = {}) {
  const { default: Modal } = await import('./ConfirmModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { flag: [], confirm: [], cancel: 0 }
  app = createApp({
    render: () => h(Modal, {
      ingredient: 'トマト',
      initialUnit: '本',
      ...props,
      onConfirm: p => events.confirm.push(p),
      onCancel: () => { events.cancel++ },
      'onToggle-flag': v => events.flag.push(v),
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}

const chips = () =>
  [...host.querySelectorAll('.name-hints .hint-chip')].map(e => e.textContent.trim())
const actionLabels = () =>
  [...host.querySelectorAll('.actions .btn')].map(e => e.textContent.trim())
const button = label =>
  [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('ConfirmModal — 数量シートは1枚に収める', () => {
  it('通常の数量入力では見出しの行を持たない（すぐ下に品目名が出る）', async () => {
    await mount()
    expect(host.querySelector('.sheet-title')).toBeNull()
    expect(host.querySelector('.name-text').textContent).toBe('トマト')
  })

  it('編集・新規登録では見出しを出す（何をしているか自明でない）', async () => {
    await mount({ isEdit: true })
    expect(host.querySelector('.sheet-title').textContent).toBe('品目を編集')
    app.unmount(); host.remove(); vi.resetModules()

    await mount({ isNew: true })
    expect(host.querySelector('.sheet-title').textContent).toBe('新しい品目を登録')
  })

  it('あとで数えるは品目名の行にあり、全幅の行を持たない', async () => {
    const events = await mount()

    expect(host.querySelector('.recount-toggle'), '全幅の行は無い').toBeNull()
    const flag = host.querySelector('.name-row .name-flag')
    expect(flag, '品目名の行にある').not.toBeNull()
    expect(flag.getAttribute('aria-pressed')).toBe('false')
    expect(flag.getAttribute('aria-label')).toContain('あとで数える')

    flag.click()
    await nextTick()
    expect(events.flag).toEqual([true])
  })

  it('ONのときは印が変わり、ヒント行にも状態が出る', async () => {
    await mount({ isFlagged: true })
    expect(host.querySelector('.name-flag').classList.contains('on')).toBe(true)
    expect(chips().some(t => t.includes('あとで数える'))).toBe(true)
  })

  it('入数・前月・ジャンル・履歴は1行のチップにまとまる', async () => {
    await mount({
      lotSize: '24本',
      prevMonth: '12',
      initialCategory: '野菜',
      auditLog: [{ id: 1, ingredient: 'トマト', action: 'new', delta: 3, unit: '本', totalQty: 3, timestamp: Date.now() }],
    })

    // ジャンルと履歴が自分の行を持っていた分がチップへ移っている
    expect(host.querySelector('.genre-locked-badge'), 'ジャンルの行は無い').toBeNull()
    expect(host.querySelector('.history-toggle'), '履歴の行は無い').toBeNull()

    const t = chips().join(' / ')
    expect(t).toContain('入数: 24本')
    expect(t).toContain('前月: 12')
    expect(t).toContain('野菜')
    expect(t).toContain('履歴 1件')
  })

  it('履歴のチップで開閉でき、開くと中身が出る', async () => {
    await mount({
      auditLog: [{ id: 1, ingredient: 'トマト', action: 'new', delta: 3, unit: '本', totalQty: 3, timestamp: Date.now() }],
    })
    const chip = host.querySelector('.hint-history')

    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('.history-list')).toBeNull()

    chip.click()
    await nextTick()
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.history-list')).not.toBeNull()
  })

  it('発注ではジャンルのチップを出さない（発注中に読む情報ではない）', async () => {
    await mount({ orderMode: true, initialCategory: '野菜' })
    expect(chips().some(t => t.includes('野菜'))).toBe(false)
  })

  it('テンキーと確定は1つの塊のまま（打つ場所が動かない仕掛けを壊さない）', async () => {
    await mount()
    const dock = host.querySelector('.keypad-dock')
    expect(dock).not.toBeNull()
    expect(dock.querySelector('.numpad')).not.toBeNull()
    expect(dock.querySelector('.actions')).not.toBeNull()
  })

  // 前回のテストで「あとで数える」が使われなかったのは、抜ける瞬間（▶・キャンセル）に
  // その道が無く、印が画面の上の飾りに見えていたため。決める場所と同じ行へ置く。
  it('棚卸も発注も、下部は キャンセル / 後で / 確定 の3つ', async () => {
    await mount()
    expect(actionLabels()).toEqual(['キャンセル', '後で', '確定'])
    app.unmount(); host.remove(); vi.resetModules()

    await mount({ orderMode: true })
    expect(actionLabels()).toEqual(['キャンセル', '後で', '発注なしで確定'])
  })

  it('棚卸の「後で」は、あとで数える印を付けて閉じる', async () => {
    const events = await mount()

    button('後で').click()
    await nextTick()

    expect(events.flag, '印を付ける').toEqual([true])
    expect(events.cancel, '閉じる').toBe(1)
    expect(events.confirm, '数えていないので保存はしない').toEqual([])
  })

  it('数を打ってあれば「後で」でも捨てず、印を付けたうえで保存する', async () => {
    const events = await mount()
    button('3').click()
    await nextTick()

    button('後で').click()
    await nextTick()

    expect(events.flag).toEqual([true])
    expect(events.confirm.length, '打った数は残す').toBe(1)
    expect(events.confirm[0].qty).toBe(3)
  })

  it('既に印が付いていれば、二重に付け直さない', async () => {
    const events = await mount({ isFlagged: true })
    button('後で').click()
    await nextTick()
    expect(events.flag).toEqual([])
    expect(events.cancel).toBe(1)
  })

  it('既に誰かが入れている時も、3つ並びは崩さず「足す」を別に出す', async () => {
    await mount({ existing: { qty: 12, unit: '本' } })

    expect(actionLabels()).toEqual(['キャンセル', '後で', '上書き'])
    expect(host.querySelector('.btn-add'), '足すは3つ並びの外に出る').not.toBeNull()
  })

  // 貼り付けたままだと影の帯が常に出て、見出しのシートとキーのシートが重なって見える
  // （User報告 2026-09-07）。棚卸も発注も1枚に収めたので、どちらも貼り付けない。
  it('棚卸も発注も貼り付けない', async () => {
    await mount()
    expect(host.querySelector('.keypad-dock').classList.contains('stuck')).toBe(false)
    app.unmount(); host.remove(); vi.resetModules()

    await mount({ orderMode: true })
    expect(host.querySelector('.keypad-dock').classList.contains('stuck')).toBe(false)
  })

  it('発注も棚卸と同じ骨格（見出し無し・欄は1つ・専用の塊を持たない）', async () => {
    await mount({ orderMode: true, replenish: { value: 24, source: 'reorder', basis: 'x' } })

    expect(host.querySelector('.sheet-title'), '見出しは持たない').toBeNull()
    expect(host.querySelectorAll('.qty-display').length, '打つ欄は1つ').toBe(1)
    expect(host.querySelector('.order-block'), '発注専用の塊は無い').toBeNull()
    expect(host.querySelector('.dock-now'), 'キーの上の別表示も無い').toBeNull()
    // 参考値は棚卸と同じヒント行に入る
    expect(host.querySelector('.name-hints .hint-ref')).not.toBeNull()
  })
})
