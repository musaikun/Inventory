// 棚卸履歴の詳細画面。要件（User）:
//   ・誰が参加していたか
//   ・それぞれの参加者が何品目登録したか（**重複あり**）
//   ・重複して変更があった品目が見た目で分かること
//   ・品目一覧から品目ごとの変更履歴を開けること
//     （変更履歴タブのタイムスタンプのベタ書きは調査に使えないため、こちらで補う）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

const T = 1_700_000_000_000
const e = (id, item, by, byId, action, totalQty, at) => ({
  id, ingredient: item, action, delta: 0, totalQty, unit: '個',
  enteredBy: by, enteredById: byId, timestamp: at,
})

// 端末A: トマト・レタス / 端末B: トマト（Aのあと）・キャベツ
const SNAPSHOT = {
  date: '2026-08-09',
  savedAt: '2026-08-09T10:00:00.000Z',
  sessionId: 'sess-1',
  items: [
    { item: 'トマト',   qty: 8, unit: '個', unitPrice: 100, subtotal: 800, code: '', flagged: false, category: null },
    { item: 'レタス',   qty: 5, unit: '個', unitPrice: 100, subtotal: 500, code: '', flagged: false, category: null },
    { item: 'キャベツ', qty: 2, unit: '個', unitPrice: 100, subtotal: 200, code: '', flagged: false, category: null },
  ],
  totalValue: 1500,
  entryLog: ['トマト', 'レタス', 'キャベツ'],
  participants: null,
  flaggedItems: [],
  auditLog: [
    e('1', 'トマト',   '端末A', 'dev-a', 'new',       3, T),
    e('2', 'レタス',   '端末A', 'dev-a', 'new',       5, T + 60_000),
    e('3', 'トマト',   '端末B', 'dev-b', 'overwrite', 8, T + 120_000),
    e('4', 'キャベツ', '端末B', 'dev-b', 'new',       2, T + 180_000),
  ],
  activeMs: 180_000,
  axisNames: ['', ''],
}

async function mount(snapshot = SNAPSHOT) {
  const { default: Page } = await import('./SessionDetailPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Page, { snapshot, isHost: true }) })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

const tab = (label) => [...host.querySelectorAll('.tab-btn')].find(b => b.textContent.includes(label))
async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick(); await nextTick()
}
const sections = () => [...host.querySelectorAll('.participant-section')]

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('参加者別', () => {
  it('参加者ごとに操作件数を重複ありで出す', async () => {
    await mount()
    await click(tab('参加者別'))

    const rows = sections().map(s => [
      s.querySelector('.participant-name').textContent.trim(),
      s.querySelector('.pmeta-chip').textContent.trim(),
    ])
    // トマトは A→B の2操作。どちらの担当にも1件ずつ数える
    expect(rows).toEqual([['端末A', '2件'], ['端末B', '2件']])
  })

  it('タブの見出しに参加者数を出す', async () => {
    await mount()
    expect(tab('参加者別').textContent).toContain('(2)')
  })

  it('他の担当者も変更した品目に印を付ける', async () => {
    await mount()
    await click(tab('参加者別'))

    // 「重複 1品目」チップ
    expect(sections()[0].textContent).toContain('重複 1品目')
    // トマトの行だけ shared
    const shared = [...sections()[0].querySelectorAll('.pi-row.shared')]
    expect(shared.map(r => r.querySelector('.pi-name').textContent.trim())).toEqual(['トマト'])
  })

  it('金額は最後に入力した人にだけ計上する（重複させない）', async () => {
    await mount()
    await click(tab('参加者別'))
    // A はレタス500だけ / B はトマト800＋キャベツ200
    expect(sections()[0].querySelector('.pmeta-value').textContent).toContain('500')
    expect(sections()[1].querySelector('.pmeta-value').textContent).toContain('1,000')
  })

  it('参加者の行をタップすると、その品目の変更履歴が開く', async () => {
    await mount()
    await click(tab('参加者別'))
    await click(sections()[0].querySelector('.pi-row.shared'))

    const sheet = host.querySelector('.ih-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.querySelector('.ih-title').textContent.trim()).toBe('トマト')
  })

  it('変更履歴が無い古い履歴は、保存済みの参加者別へ落として断り書きを出す', async () => {
    await mount({ ...SNAPSHOT, auditLog: [], participants: [
      { name: '端末A', items: [{ item: 'トマト', qty: 8, unit: '個' }], totalValue: 800 },
    ] })
    await click(tab('参加者別'))
    expect(sections()).toHaveLength(1)
    expect(host.textContent).toContain('変更履歴が残っていないため')
  })
})

describe('品目一覧から品目ごとの変更履歴', () => {
  it('品目をタップすると、その品目の変更が新しい順で出る', async () => {
    await mount()
    const row = [...host.querySelectorAll('.item-row')].find(r => r.textContent.includes('トマト'))
    await click(row)

    const rows = [...host.querySelectorAll('.ih-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.ih-by').textContent.trim()).toBe('端末B')
    expect(rows[0].querySelector('.ih-qty').textContent.trim()).toBe('8個')
    expect(rows[1].querySelector('.ih-by').textContent.trim()).toBe('端末A')
  })

  it('複数人が変更した品目はその旨を出す', async () => {
    await mount()
    const row = [...host.querySelectorAll('.item-row')].find(r => r.textContent.includes('トマト'))
    await click(row)
    expect(host.querySelector('.ih-sub').textContent).toContain('2人が変更')
  })

  it('1人だけの品目には重複の表示を出さない', async () => {
    await mount()
    const row = [...host.querySelectorAll('.item-row')].find(r => r.textContent.includes('レタス'))
    await click(row)
    expect(host.querySelector('.ih-sub').textContent).not.toContain('人が変更')
  })

  it('複数人が変更した品目は一覧で色を変える', async () => {
    await mount()
    const highlighted = [...host.querySelectorAll('.item-row.highlight')]
    expect(highlighted.map(r => r.querySelector('.name-main').textContent.trim())).toEqual(['トマト'])
  })

  it('変更履歴タブは残す（品目をまたいだ時系列はここでしか追えない）', async () => {
    await mount()
    expect(tab('変更履歴')).not.toBeUndefined()
    await click(tab('変更履歴'))
    expect(host.querySelectorAll('.log-entry')).toHaveLength(4)
  })

  it('サーバー経由で時刻が文字列になっていても時刻を表示できる', async () => {
    // server は以前 timestamp を文字列で保存していた（new Date("170…") は Invalid Date）
    await mount({
      ...SNAPSHOT,
      auditLog: SNAPSHOT.auditLog.map(x => ({ ...x, timestamp: String(x.timestamp) })),
    })
    await click(tab('変更履歴'))
    const times = [...host.querySelectorAll('.log-time')].map(t => t.textContent.trim())
    expect(times.every(t => t && !t.includes('Invalid'))).toBe(true)
  })
})
