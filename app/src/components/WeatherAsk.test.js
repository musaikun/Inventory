// カレンダーの天気：初めてカレンダーを開いたときに一度だけ訊き、以降は訊かない（変更は各種設定から）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

let app = null, host = null
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function mount() {
  const { default: C } = await import('./WeatherAsk.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(C); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); vi.resetModules() })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.unstubAllGlobals() })

describe('カレンダーの天気を訊く', () => {
  it('「今はしない」→ 各種設定から変えられると伝え、以降は訊かない', async () => {
    await mount()
    expect(host.textContent).toContain('位置情報を許可しますか？')
    btn('今はしない').click(); await tick()
    expect(host.textContent).toContain('天気は表示しません')
    expect(host.textContent).toContain('各種設定')
    btn('OK').click(); await tick()
    expect(host.querySelector('.wa')).toBeNull()
    app.unmount(); host.remove(); vi.resetModules()
    await mount()
    expect(host.querySelector('.wa')).toBeNull()
  })

  it('許可すると現在地で表示し、同じく以降は訊かない', async () => {
    const W = await import('../composables/useWeather.js')
    vi.spyOn(W, 'requestGeolocation')
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 35.68, longitude: 139.76 } }) } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await mount()
    btn('許可して表示する').click(); await tick(); await new Promise(r => setTimeout(r, 0)); await tick()
    expect(host.textContent).toContain('カレンダーに天気を表示します')
    expect(localStorage.getItem('weather_asked')).toBe('1')
    expect(JSON.parse(localStorage.getItem('weather_loc')).lat).toBeCloseTo(35.68)
  })

  it('すでに位置がある端末には訊かない', async () => {
    localStorage.setItem('weather_loc', JSON.stringify({ lat: 35, lon: 139, name: '東京' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await mount()
    expect(host.querySelector('.wa')).toBeNull()
  })
})
