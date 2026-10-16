// 設定タブの中身（User決定 2026-10-16）。各種設定の中身を直接並べ、見えるものは権限で変える。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const updateStoreName = vi.fn(async () => ({ storeName: '二号店' }))
let staff = null, admin = true
vi.mock('../composables/useAuth.js', async () => {
  const { ref, computed } = await import('vue')
  const st = ref(null), ad = ref(true)
  globalThis.__sl = { st, ad }
  return {
    isAuthenticated: ref(true), storeName: ref('本店'), ownerName: ref('無才'),
    currentStaff: computed(() => st.value), isAdmin: computed(() => ad.value),
    can: () => ad.value, updateStoreName: (...a) => updateStoreName(...a), updateOwnerName: vi.fn(),
  }
})
vi.mock('../composables/usePush.js', async () => { const { ref } = await import('vue'); return { pushSubscribed: ref(true) } })

let app = null, host = null
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const row = label => [...host.querySelectorAll('.sl-it')].find(b => b.querySelector('b')?.textContent === label)
async function mount(part) {
  await import('../composables/useAuth.js')
  globalThis.__sl.st.value = staff; globalThis.__sl.ad.value = admin
  const { default: C } = await import('./SettingsList.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(C, { part }) }); app.mount(host); await tick()
}
beforeEach(() => { staff = null; admin = true; updateStoreName.mockClear() })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('設定タブ', () => {
  it('オーナー: お店・発注。店名はその場で変えられる', async () => {
    await mount('top')
    expect([...host.querySelectorAll('.sl-sec')].map(e => e.textContent)).toEqual(['お店', '発注'])
    expect(row('オーナーの名前').textContent).toContain('無才')
    await click(row('店名'))
    const input = host.querySelector('input[aria-label="店名"]')
    input.value = '二号店'; input.dispatchEvent(new Event('input'))
    await click([...host.querySelectorAll('.sl-btn')].find(b => b.textContent === '店名を変える'))
    expect(updateStoreName).toHaveBeenCalledWith('二号店')
  })

  it('下のほう: この端末・アカウント・サポート。押すとその項目だけのシート', async () => {
    const { settingsSection } = await import('../composables/appMenuState.js')
    await mount('bottom')
    expect([...host.querySelectorAll('.sl-sec')].map(e => e.textContent)).toEqual(['この端末', 'アカウント', 'サポート'])
    expect(row('通知').textContent).toContain('ON')
    expect(row('端末名')).toBeUndefined()   // ログインしている端末には出さない
    await click(row('カレンダーの天気'))
    expect(settingsSection.value).toBe('weather')
  })

  it('スタッフ（アルバイト）: お店・発注・アカウントは出さない', async () => {
    staff = { id: 'st_a', name: '山田', role: 'arbeit' }; admin = false
    await mount('top')
    expect(host.querySelectorAll('.sl-sec')).toHaveLength(1)   // お店（店名を見るだけ）
    expect(row('店名').disabled).toBe(true)
    expect(row('スタッフ')).toBeUndefined()
    expect(row('オーナーの名前')).toBeUndefined()
    app.unmount(); host.remove()
    await mount('bottom')
    expect([...host.querySelectorAll('.sl-sec')].map(e => e.textContent)).toEqual(['この端末', 'サポート'])
  })
})
