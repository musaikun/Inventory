// WMO weather code → アイコン/ラベル（Open-Meteo の weather_code 用・純関数）。
// https://open-meteo.com/en/docs（WMO Weather interpretation codes）

export function weatherCodeInfo(code) {
  const c = Number(code)
  if (c === 0) return { icon: '☀️', label: '快晴' }
  if (c === 1) return { icon: '🌤️', label: '晴れ' }
  if (c === 2) return { icon: '⛅', label: '晴れ時々曇り' }
  if (c === 3) return { icon: '☁️', label: '曇り' }
  if (c === 45 || c === 48) return { icon: '🌫️', label: '霧' }
  if (c >= 51 && c <= 57) return { icon: '🌦️', label: '霧雨' }
  if (c >= 61 && c <= 67) return { icon: '🌧️', label: '雨' }
  if (c >= 71 && c <= 77) return { icon: '🌨️', label: '雪' }
  if (c >= 80 && c <= 82) return { icon: '🌦️', label: 'にわか雨' }
  if (c === 85 || c === 86) return { icon: '🌨️', label: 'にわか雪' }
  if (c >= 95 && c <= 99) return { icon: '⛈️', label: '雷雨' }
  return { icon: '', label: '' }
}

// Open-Meteo daily レスポンス → { 'YYYY-MM-DD': { icon, label, tempHi, tempLo, pop } }
export function mapDailyToWeather(daily) {
  const out = {}
  if (!daily || !Array.isArray(daily.time)) return out
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  for (let i = 0; i < daily.time.length; i++) {
    const wc = weatherCodeInfo(daily.weather_code?.[i])
    out[daily.time[i]] = {
      icon:   wc.icon,
      label:  wc.label,
      tempHi: num(daily.temperature_2m_max?.[i]),
      tempLo: num(daily.temperature_2m_min?.[i]),
      pop:    num(daily.precipitation_probability_max?.[i]),
    }
  }
  return out
}
