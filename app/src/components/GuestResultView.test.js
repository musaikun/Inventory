// 共有URLの閲覧画面（参加者別）。担当者は閉じた状態で並び、タップで開く。開いた人の品目は枠の中で送れる。
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import GuestResultView from './GuestResultView.vue'

let app, root
afterEach(() => { app?.unmount(); root?.remove() })

function mount(result) {
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GuestResultView, { result })
  app.mount(root)
  return root
}

const result = {
  date: '2026-09-30',
  items: [{ item: 'りんご', qty: 3, unit: '個' }, { item: 'みかん', qty: 5, unit: '個' }],
  participants: [
    { name: 'Aさん', items: [{ item: 'りんご', qty: 3, unit: '個' }] },
    { name: 'Bさん', items: [{ item: 'みかん', qty: 5, unit: '個' }] },
  ],
}

describe('GuestResultView 参加者別', () => {
  it('はじめは全員閉じていて、タップした人だけ品目が出る', async () => {
    const r = mount(result)
    const heads = r.querySelectorAll('.participant-header')
    expect(heads).toHaveLength(2)
    expect(r.querySelectorAll('.participant-items')).toHaveLength(0)
    expect(heads[0].getAttribute('aria-expanded')).toBe('false')

    heads[0].click(); await nextTick()
    const open = r.querySelectorAll('.participant-items')
    expect(open).toHaveLength(1)
    expect(open[0].textContent).toContain('りんご')
    expect(open[0].textContent).not.toContain('みかん')

    heads[0].click(); await nextTick()
    expect(r.querySelectorAll('.participant-items')).toHaveLength(0)
  })
})

describe('GuestResultView レポート・振り分け', () => {
  it('レポートは履歴のレポートと同じ（在庫金額・件数・前回比・担当者）', async () => {
    const r = mount({
      ...result,
      savedAt: '2026-09-30T10:00:00Z',
      totalValue: 1500,
      items: [{ item: 'りんご', qty: 3, unit: '個', unitPrice: 500, subtotal: 1500 }, { item: 'みかん', qty: null, unit: '個' }],
      prevCandidates: [{ sessionId: 'p', date: '2026-08-31', savedAt: '2026-08-31T10:00:00Z', totalValue: 1000,
        items: [{ item: 'りんご', qty: 2, unit: '個', subtotal: 1000 }] }],
    })
    const tab = [...r.querySelectorAll('.tab-btn')].find(b => b.textContent.includes('レポート'))
    tab.click(); await nextTick()
    const text = r.querySelector('.guest-body').textContent
    expect(text).toContain('在庫金額')
    expect(text).toContain('¥1,500')
    expect(text).toContain('入力済み品目')
    expect(text).toContain('前回（2026-08-31）との比較')
    expect(text).toContain('+¥500')
    expect(text).toContain('Aさん')
  })
  it('セッションで使った振り分けを選べる', async () => {
    const r = mount({ ...result, axisNames: ['保管場所', ''], items: result.items.map(it => ({ ...it, category: '果物', tagA: '冷蔵庫' })) })
    const btn = [...r.querySelectorAll('.seg-btn')].find(b => b.textContent.includes('保管場所'))
    expect(btn).toBeTruthy()
  })
})

describe('GuestResultView スワイプでタブ送り', () => {
  const swipe = async (el, dx) => {
    const t = (x) => ({ changedTouches: [{ clientX: x, clientY: 100 }] })
    el.dispatchEvent(Object.assign(new Event('touchstart'), t(200)))
    el.dispatchEvent(Object.assign(new Event('touchmove'), t(200 + dx)))
    el.dispatchEvent(Object.assign(new Event('touchend'), t(200 + dx)))
    await nextTick()
  }
  const active = r => r.querySelector('.tab-btn.active').textContent

  it('左へ払うと右のタブ、右へ払うと左のタブ。端では止まる', async () => {
    const r = mount(result)   // 変更履歴なし＝参加者別が右端
    const body = r.querySelector('.guest-body')
    expect(active(r)).toContain('品目一覧')
    await swipe(body, -120)
    expect(active(r)).toContain('参加者別')
    await swipe(body, -120)
    expect(active(r)).toContain('参加者別')
    await swipe(body, 120); await swipe(body, 120)
    expect(active(r)).toContain('レポート')
    await swipe(body, 120)
    expect(active(r)).toContain('レポート')
  })
})

describe('GuestResultView 前回との差の知らせ', () => {
  const withPrev = {
    ...result,
    savedAt: '2026-09-30T10:00:00Z',
    items: [
      { item: 'りんご', qty: 10, unit: '個' },
      { item: 'みかん', qty: 1, unit: '個' },
      { item: 'ぶどう', qty: 0, unit: '房' },
    ],
    prevCandidates: [{ sessionId: 'p', date: '2026-08-31', savedAt: '2026-08-31T10:00:00Z',
      items: [{ item: 'りんご', qty: 2, unit: '個' }, { item: 'みかん', qty: 5, unit: '個' }, { item: 'ぶどう', qty: 3, unit: '房' }] }],
  }

  it('前回より多い・少ない品目があれば、目立つ知らせを出し、押すとレポートへ', async () => {
    const r = mount(withPrev)
    const a = r.querySelector('.qty-alert')
    expect(a).not.toBeNull()
    expect(a.textContent).toContain('前回より多い品目 1件・少ない品目 2件があります')
    expect(a.textContent).toContain('レポートから確認してください')
    a.click(); await nextTick()
    expect(r.querySelector('.tab-btn.active').textContent).toContain('レポート')
    expect(r.querySelector('.qty-alert')).toBeNull()   // レポートを開いている間は出さない
  })

  it('大きな動きが無ければ出さない', () => {
    const r = mount(result)
    expect(r.querySelector('.qty-alert')).toBeNull()
  })
})

describe('GuestResultView ジャンルの並び', () => {
  it('店舗のいまのホームの並び（homeLayout）を、完了時の並び・品目の並びより優先する', async () => {
    const r = mount({
      ...result,
      items: [
        { item: 'a', qty: 1, unit: '', category: 'ビール' },
        { item: 'b', qty: 1, unit: '', category: 'コーヒー豆' },
        { item: 'c', qty: 1, unit: '', category: 'パスタ' },
      ],
      categoryOrder: ['ビール', 'パスタ', 'コーヒー豆'],
      homeLayout: { categoryOrder: ['コーヒー豆', 'パスタ', 'ビール'], axisGroupsA: [], axisGroupsB: [] },
    })
    await nextTick()
    const labels = [...r.querySelectorAll('.cat-label')].map(e => e.textContent.trim())
    expect(labels).toEqual(['コーヒー豆', 'パスタ', 'ビール'])
  })
})
