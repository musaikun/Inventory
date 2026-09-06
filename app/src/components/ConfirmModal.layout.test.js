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
  const events = { flag: [] }
  app = createApp({
    render: () => h(Modal, {
      ingredient: 'トマト',
      initialUnit: '本',
      ...props,
      onConfirm: () => {},
      onCancel: () => {},
      'onToggle-flag': v => events.flag.push(v),
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}

const chips = () =>
  [...host.querySelectorAll('.name-hints .hint-chip')].map(e => e.textContent.trim())

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

  it('編集・新規登録・発注では見出しを出す（何をしているか自明でない）', async () => {
    await mount({ isEdit: true })
    expect(host.querySelector('.sheet-title').textContent).toBe('品目を編集')
    app.unmount(); host.remove(); vi.resetModules()

    await mount({ isNew: true })
    expect(host.querySelector('.sheet-title').textContent).toBe('新しい品目を登録')
    app.unmount(); host.remove(); vi.resetModules()

    await mount({ orderMode: true })
    expect(host.querySelector('.sheet-title').textContent).toBe('発注数を入力')
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

  // 貼り付けが要るのはシートが画面より高いときだけ。1枚に収まった通常の入力で
  // 貼り付けたままだと、影の帯が常に出て紙が2つに割れて見える。
  it('通常の数量入力では貼り付けず、発注では貼り付けたままにする', async () => {
    await mount()
    expect(host.querySelector('.keypad-dock').classList.contains('stuck')).toBe(false)
    app.unmount(); host.remove(); vi.resetModules()

    await mount({ orderMode: true })
    expect(host.querySelector('.keypad-dock').classList.contains('stuck')).toBe(true)
  })
})
