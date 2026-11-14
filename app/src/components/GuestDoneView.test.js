import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import View from './GuestDoneView.vue'

let app = null
async function mount(props) {
  const host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(View, props) }); app.mount(host); await nextTick()
}
const text = () => document.body.textContent.replace(/\s+/g, ' ')
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

describe('GuestDoneView', () => {
  it('完了したこと・名前・入れた品目数を出す', async () => {
    await mount({ noun: '棚卸', name: '田中', count: 12 })
    expect(text()).toContain('お疲れさまでした')
    expect(text()).toContain('田中さん、棚卸は完了しました')
    expect(text()).toContain('12品目を入れました')
  })
  it('発注では発注と言い、品目数が分からなければ出さない', async () => {
    await mount({ noun: '発注' })
    expect(text()).toContain('発注は完了しました')
    expect(text()).not.toContain('品目を入れました')
  })
  it('閉じるを親へ伝える', async () => {
    const onClose = vi.fn()
    await mount({ onClose })
    document.querySelector('.gd-btn').click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
