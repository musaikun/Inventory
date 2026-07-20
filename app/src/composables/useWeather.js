import { reactive } from 'vue'
import { mapDailyToWeather } from '../services/weatherCodes.js'

// 天気（Open-Meteo・APIキー不要・CORS対応）。過去31日＋予報16日を日付マップで保持。
// 位置は端末に保存（localStorage）。取得結果は1時間キャッシュ。
const LOC_KEY   = 'weather_loc'    // { lat, lon, name }
const CACHE_KEY = 'weather_cache'  // { updatedAt, weather }
const TTL_MS    = 3600 * 1000

const state = reactive({ weather: {}, loc: null, loading: false, error: null, updatedAt: null })

function _load() {
  try { const r = localStorage.getItem(LOC_KEY);   if (r) state.loc = JSON.parse(r) } catch (_) {}
  try {
    const r = localStorage.getItem(CACHE_KEY)
    if (r) { const c = JSON.parse(r); state.weather = c.weather || {}; state.updatedAt = c.updatedAt || null }
  } catch (_) {}
}
function _saveLoc()   { try { localStorage.setItem(LOC_KEY, JSON.stringify(state.loc)) } catch (_) {} }
function _saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ updatedAt: state.updatedAt, weather: state.weather })) } catch (_) {} }

_load()

export async function fetchWeather(force = false) {
  if (!state.loc) return
  if (!force && state.updatedAt && Date.now() - state.updatedAt < TTL_MS && Object.keys(state.weather).length) return
  state.loading = true
  state.error = null
  try {
    const { lat, lon } = state.loc
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`
      + `&timezone=auto&past_days=31&forecast_days=16`
    const r = await fetch(url)
    if (!r.ok) throw new Error('weather http ' + r.status)
    const j = await r.json()
    state.weather = mapDailyToWeather(j.daily)
    state.updatedAt = Date.now()
    _saveCache()
  } catch (_) {
    state.error = '天気の取得に失敗しました'
  } finally {
    state.loading = false
  }
}

export function setLocation(lat, lon, name = '') {
  state.loc = { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000, name }
  _saveLoc()
  return fetchWeather(true)
}

// 端末の位置情報から取得（ユーザー操作起点で呼ぶ）
export function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('no geolocation')); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, '現在地').then(resolve).catch(reject),
      (err) => reject(err),
      { timeout: 10000, maximumAge: 3600 * 1000 },
    )
  })
}

// 位置が既にあればアプリ起動時に更新（TTL内はスキップ）
if (state.loc) fetchWeather()

export function useWeather() {
  return { state, fetchWeather, setLocation, requestGeolocation }
}
