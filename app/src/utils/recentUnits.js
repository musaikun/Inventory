/**
 * 最近選んだ単位を先に並べる（User 2026-11-14）。
 * 新しい品目は単位が「未設定」から始まり、毎回12個の中から探していた。直前の単位を
 * 黙って当てると間違った単位が気づかれずに入るので、当てはせず、選びやすい順に並べるだけ。
 * 端末ごと（業務データではない）。
 */
import { STORAGE_KEYS } from './storageKeys.js'

const MAX = 4

function _read() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentUnits) || '[]')
    return Array.isArray(v) ? v.filter(u => typeof u === 'string' && u) : []
  } catch (_) { return [] }
}

/** 選んだ単位を覚える（先頭へ） */
export function noteUnit(unit) {
  const u = String(unit ?? '').trim()
  if (!u) return
  try { localStorage.setItem(STORAGE_KEYS.recentUnits, JSON.stringify([u, ..._read().filter(x => x !== u)].slice(0, MAX))) } catch (_) {}
}

/** 選択肢を「最近選んだ順 → 残りは元の順」に並べる。選択肢に無い単位（手入力）は足さない */
export function orderUnits(options) {
  const recent = _read().filter(u => options.includes(u))
  return [...recent, ...options.filter(u => !recent.includes(u))]
}
