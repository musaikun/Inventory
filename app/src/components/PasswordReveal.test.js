// パスワード・暗証番号の 👁️：押すと中身を表示し、もう一度で隠す
import { describe, it, expect } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import PasswordReveal from './PasswordReveal.vue'

describe('PasswordReveal', () => {
  it('👁️ で表示と非表示を切り替える', async () => {
    const host = document.createElement('div')
    const app = createApp({ render: () => h(PasswordReveal, null, { default: ({ type }) => h('input', { type, value: '1234' }) }) })
    app.mount(host)
    const input = host.querySelector('input')
    const eye = host.querySelector('.pr-eye')
    expect(input.type).toBe('password')
    eye.click(); await nextTick()
    expect(input.type).toBe('text')
    expect(eye.getAttribute('aria-pressed')).toBe('true')
    eye.click(); await nextTick()
    expect(input.type).toBe('password')
    app.unmount()
  })
})
