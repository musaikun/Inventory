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
