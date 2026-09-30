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
  it('レポートは金額を出さず、件数と担当者を出す', async () => {
    const r = mount({ ...result, items: [...result.items, { item: 'なし', qty: null, unit: '', flagged: true }] })
    const tab = [...r.querySelectorAll('.tab-btn')].find(b => b.textContent.includes('レポート'))
    tab.click(); await nextTick()
    const text = r.querySelector('.guest-body').textContent
    expect(text).toContain('入力済み品目')
    expect(text).toContain('要再確認の品目')
    expect(text).toContain('Aさん')
    expect(text).not.toContain('¥')
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
