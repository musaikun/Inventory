import { describe, it, expect } from 'vitest'
import { weatherCodeInfo, mapDailyToWeather } from './weatherCodes.js'

describe('weatherCodeInfo', () => {
  it('主要な天気コードをアイコン/ラベルに変換', () => {
    expect(weatherCodeInfo(0).label).toBe('快晴')
    expect(weatherCodeInfo(3).label).toBe('曇り')
    expect(weatherCodeInfo(63).label).toBe('雨')
    expect(weatherCodeInfo(71).label).toBe('雪')
    expect(weatherCodeInfo(95).label).toBe('雷雨')
    expect(weatherCodeInfo(999).label).toBe('')  // 未知は空
  })
})

describe('mapDailyToWeather', () => {
  it('Open-Meteo daily を日付マップに変換', () => {
    const daily = {
      time: ['2026-07-20', '2026-07-21'],
      temperature_2m_max: [34.6, 35.0],
      temperature_2m_min: [24.3, 25.6],
      precipitation_probability_max: [4, 100],
      weather_code: [1, 95],
    }
    const out = mapDailyToWeather(daily)
    expect(out['2026-07-20']).toEqual({ icon: '🌤️', label: '晴れ', tempHi: 34.6, tempLo: 24.3, pop: 4 })
    expect(out['2026-07-21'].label).toBe('雷雨')
    expect(out['2026-07-21'].pop).toBe(100)
  })

  it('不正・欠損は安全に処理', () => {
    expect(mapDailyToWeather(null)).toEqual({})
    expect(mapDailyToWeather({ time: ['2026-07-20'], weather_code: [0] })['2026-07-20'].tempHi).toBe(null)
  })
})
