import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// D-019: アカウント削除の完了時だけ、天気の位置情報とキャッシュを消す。
// 通常運用（ログアウト・アカウント切替）では保持することは accountData.test.js で担保する。

const LOC   = { lat: 35.6812, lon: 139.7671, name: '東京都千代田区' }
const CACHE = { updatedAt: Date.now(), weather: { '2026-08-01': { code: 0 } } }

// モジュール初期化時の起動取得（位置が保存済みなら走る）を実ネットワークへ出さない
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
}

async function fresh() {
  vi.resetModules()
  return import('./useWeather.js')
}

beforeEach(() => { localStorage.clear(); stubFetch() })
afterEach(() => { vi.unstubAllGlobals() })

describe('useWeather: resetLocalData（アカウント削除時のみ）', () => {
  it('保存済みの位置情報とキャッシュを消す', async () => {
    localStorage.setItem('weather_loc', JSON.stringify(LOC))
    localStorage.setItem('weather_cache', JSON.stringify(CACHE))
    const m = await fresh()

    m.resetLocalData()

    expect(localStorage.getItem('weather_loc')).toBeNull()
    expect(localStorage.getItem('weather_cache')).toBeNull()
  })

  it('メモリ上の state も初期化する（リロードするまで前の位置・天気が残らない）', async () => {
    localStorage.setItem('weather_loc', JSON.stringify(LOC))
    localStorage.setItem('weather_cache', JSON.stringify(CACHE))
    const m = await fresh()

    const { state } = m.useWeather()
    expect(state.loc).toEqual(LOC)
    expect(Object.keys(state.weather)).toHaveLength(1)

    m.resetLocalData()

    expect(state.loc).toBeNull()
    expect(state.weather).toEqual({})
    expect(state.updatedAt).toBeNull()
    expect(state.error).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('位置情報が無い状態で呼んでも例外にならない', async () => {
    const m = await fresh()

    expect(() => m.resetLocalData()).not.toThrow()
    expect(localStorage.getItem('weather_loc')).toBeNull()
  })

  it('削除前に開始した天気取得の応答で、stateとcacheを復活させない', async () => {
    let resolveFetch
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveFetch = resolve })))
    const m = await fresh()

    const pending = m.useWeather().setLocation(35.6812, 139.7671, '東京')
    m.resetLocalData()
    resolveFetch({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2026-08-04'],
          temperature_2m_max: [31],
          temperature_2m_min: [24],
          precipitation_probability_max: [10],
          weather_code: [0],
        },
      }),
    })
    await pending

    const { state } = m.useWeather()
    expect(state.loc).toBeNull()
    expect(state.weather).toEqual({})
    expect(localStorage.getItem('weather_loc')).toBeNull()
    expect(localStorage.getItem('weather_cache')).toBeNull()
  })

  it('削除前に開始した逆ジオコーディングで位置情報を復活させない', async () => {
    let resolveGeocode
    vi.stubGlobal('fetch', vi.fn(url => {
      if (String(url).includes('reverse-geocode-client')) {
        return new Promise(resolve => { resolveGeocode = resolve })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], weather_code: [] } }),
      })
    }))
    const m = await fresh()

    await m.useWeather().setLocation(35.6812, 139.7671)
    m.resetLocalData()
    resolveGeocode({ ok: true, json: async () => ({ principalSubdivision: '東京都', locality: '千代田区' }) })
    await Promise.resolve()
    await Promise.resolve()

    expect(m.useWeather().state.loc).toBeNull()
    expect(localStorage.getItem('weather_loc')).toBeNull()
  })

  it('削除前に要求した位置情報の遅延callbackで位置情報を復活させない', async () => {
    let onSuccess
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition(success) { onSuccess = success },
      },
    })
    const m = await fresh()

    const pending = m.useWeather().requestGeolocation()
    m.resetLocalData()
    onSuccess({ coords: { latitude: 35.6812, longitude: 139.7671 } })
    await pending

    expect(m.useWeather().state.loc).toBeNull()
    expect(localStorage.getItem('weather_loc')).toBeNull()
  })
})
