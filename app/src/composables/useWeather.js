import { reactive } from 'vue'
import { mapDailyToWeather } from '../services/weatherCodes.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 天気（Open-Meteo・APIキー不要・CORS対応）。過去31日＋予報16日を日付マップで保持。
// 位置は端末に保存（localStorage）。取得結果は1時間キャッシュ。
const LOC_KEY   = STORAGE_KEYS.weatherLoc    // { lat, lon, name }
const CACHE_KEY = STORAGE_KEYS.weatherCache  // { updatedAt, weather }
const TTL_MS    = 3600 * 1000

const state = reactive({ weather: {}, loc: null, loading: false, error: null, updatedAt: null })
let _generation = 0

function _isCurrent(generation, loc) {
  return generation === _generation
    && state.loc?.lat === loc.lat
    && state.loc?.lon === loc.lon
}

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
  const generation = _generation
  const loc = { ...state.loc }
  state.loading = true
  state.error = null
  try {
    const { lat, lon } = loc
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`
      + `&timezone=auto&past_days=31&forecast_days=16`
    const r = await fetch(url)
    if (!r.ok) throw new Error('weather http ' + r.status)
    const j = await r.json()
    // アカウント削除や位置変更より前に開始した応答で、消去済みデータを復活させない。
    if (!_isCurrent(generation, loc)) return
    state.weather = mapDailyToWeather(j.daily)
    state.updatedAt = Date.now()
    _saveCache()
  } catch (_) {
    if (_isCurrent(generation, loc)) state.error = '天気の取得に失敗しました'
  } finally {
    if (_isCurrent(generation, loc)) state.loading = false
  }
}

// 逆ジオコーディング（BigDataCloud・APIキー不要・CORS対応）→ 「都道府県＋市区町村」
async function _reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`)
    if (!r.ok) return ''
    const j = await r.json()
    const parts = [j.principalSubdivision, j.locality].filter(Boolean)
    return [...new Set(parts)].join('') || j.city || ''
  } catch (_) { return '' }
}

export function setLocation(lat, lon, name = '') {
  const generation = _generation
  const loc = { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000, name }
  state.loc = loc
  _saveLoc()
  // 地名を非同期取得して更新（未指定時のみ）
  if (!name) {
    _reverseGeocode(loc.lat, loc.lon).then(n => {
      if (n && _isCurrent(generation, loc)) {
        state.loc = { ...state.loc, name: n }
        _saveLoc()
      }
    })
  }
  return fetchWeather(true)
}

// 端末の位置情報から取得（ユーザー操作起点で呼ぶ）
export function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('no geolocation')); return }
    const generation = _generation
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (generation !== _generation) { resolve(); return }
        setLocation(pos.coords.latitude, pos.coords.longitude).then(resolve).catch(reject)
      },
      (err) => generation === _generation ? reject(err) : resolve(),
      { timeout: 10000, maximumAge: 3600 * 1000 },
    )
  })
}

/**
 * アカウント削除の完了時だけ呼ぶ（D-019）。ログアウト・アカウント切替では呼ばない
 * （端末の物理的な位置は、利用する店舗が変わっても同じであるため）。
 *
 * 位置情報と天気キャッシュを localStorage から消し、メモリ上の state も初期化する。
 * state を戻さないと、削除後もリロードするまで前の位置・天気が表示され続ける。
 */
export function resetLocalData() {
  // 進行中のfetch / geolocation / reverse-geocodeを論理的に失効させる。
  _generation++
  state.weather   = {}
  state.loc       = null
  state.loading   = false
  state.error     = null
  state.updatedAt = null
  try { localStorage.removeItem(LOC_KEY) }   catch (_) {}
  try { localStorage.removeItem(CACHE_KEY) } catch (_) {}
}

// 位置が既にあればアプリ起動時に更新（TTL内はスキップ）
if (state.loc) fetchWeather()

export function useWeather() {
  return { state, fetchWeather, setLocation, requestGeolocation }
}
