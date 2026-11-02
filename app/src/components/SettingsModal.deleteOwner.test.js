/**
 * アカウント削除はオーナーだけ（User決定 2026-11-02）。
 * スタッフ（管理者を含む）としてログインしている端末には削除ボタンを出さない。
 * サーバーも 403 owner_only で断る（worker/src/accountDeletion.test.js）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mountAccountSection({ staff }) {
  localStorage.clear()
  localStorage.setItem('_auth_token', 'tok')
  if (staff) localStorage.setItem('_auth_staff', JSON.stringify(staff))
  vi.resetModules()
  const { default: Settings } = await import('./SettingsModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Settings, { section: 'account', onClose: () => {} }) })
  app.mount(host)
  await nextTick()
}
const deleteButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('アカウントを削除する'))

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
  localStorage.clear()
})

describe('アカウント削除の入口はオーナーだけ', () => {
  it('オーナーには削除ボタンが出る', async () => {
    await mountAccountSection({ staff: null })
    expect(deleteButton()).toBeTruthy()
  })

  it('管理者のスタッフには出さず、オーナーだけと伝える', async () => {
    await mountAccountSection({ staff: { id: 'st_0123456789abcdef', name: '鈴木', role: 'admin' } })
    expect(deleteButton()).toBeFalsy()
    expect(host.textContent).toContain('アカウントの削除はオーナーだけができます')
  })
})
