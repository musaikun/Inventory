// トップの進行中のカード（User 2026-10-07）: ルームの最近の変更を上から流す
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, nextTick, reactive, h } from 'vue'
import LiveSessionCard from './LiveSessionCard.vue'

let app = null, host = null
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('LiveSessionCard', () => {
  it('進み具合・つないでいる人・最近の変更を出し、新しい変更は一番上に入る', async () => {
    const now = Date.now()
    const props = reactive({
      kind: 'stock', session: { id: 's1', startedAt: '2026-10-07T00:10:00Z' }, count: 12,
      live: { totalItems: 40, participants: [{ name: '山田' }, { name: '佐藤' }], recent: [
        { id: 'a', at: now - 120000, item: 'トマト', qty: 3, unit: '個', action: 'new', by: '山田' },
      ] },
    })
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp({ render: () => h(LiveSessionCard, props) })
    app.mount(host); await nextTick()
    expect(host.textContent).toContain('12 / 40 品目')
    expect(host.querySelectorAll('.lc-av').length).toBe(2)
    expect(host.querySelector('.lc-ev').textContent).toContain('山田')
    expect(host.querySelector('.lc-ev').textContent).toContain('トマト 3個')
    expect(host.querySelector('.lc-ev').textContent).toContain('2分前')
    props.live = { ...props.live, recent: [
      { id: 'b', at: now, item: '牛乳', qty: 5, unit: '本', action: 'add', delta: 2, by: '佐藤' },
      ...props.live.recent,
    ] }
    await nextTick()
    const rows = [...host.querySelectorAll('.lc-ev')]
    expect(rows[0].textContent).toContain('佐藤')
    expect(rows[0].textContent).toContain('牛乳 5本（+2）')
    expect(rows[0].textContent).toContain('たった今')
  })

  it('ルームが無いとき（ひとりで数えている）は人と流れを出さない', async () => {
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp(LiveSessionCard, { session: { id: 's1', startedAt: '' }, count: 3, live: null })
    app.mount(host); await nextTick()
    expect(host.textContent).toContain('棚卸の途中')
    expect(host.querySelector('.lc-feed')).toBeNull()
    expect(host.querySelector('.lc-people')).toBeNull()
  })
})
