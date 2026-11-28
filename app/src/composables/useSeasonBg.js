import { ref } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

/**
 * ホームの背景を月ごとに変えるか（端末ごと・既定はオン・User決定 2026-11-28）。
 * オフにすると、輪はいつもの色で、モチーフは出さない。設定の「この端末」から切り替える
 */
function _read() { try { return localStorage.getItem(STORAGE_KEYS.seasonBg) !== '0' } catch (_) { return true } }
export const seasonBgOn = ref(_read())
export function setSeasonBg(on) {
  seasonBgOn.value = !!on
  try { localStorage.setItem(STORAGE_KEYS.seasonBg, on ? '1' : '0') } catch (_) { /* 覚えられなくても今は切り替わる */ }
}
