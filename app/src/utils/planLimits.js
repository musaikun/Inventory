// Free プランの制限値
export const FREE_DEVICE_LIMIT  = 2
export const FREE_HISTORY_DAYS  = 30

// localStorage にプロプランフラグが立っているか（将来のStripe連携用）
export function isPro() {
  return localStorage.getItem('tanaoro_is_pro') === '1'
}

// 接続デバイス数チェック（Freeは2台まで）
export function canJoinRoom(currentParticipantCount) {
  if (isPro()) return true
  return currentParticipantCount < FREE_DEVICE_LIMIT
}

// 履歴表示制限（Freeは30日以内のみ）
export function isHistoryVisible(dateStr) {
  if (isPro()) return true
  if (!dateStr) return false
  const ms   = Date.now() - new Date(dateStr).getTime()
  const days = ms / (1000 * 60 * 60 * 24)
  return days <= FREE_HISTORY_DAYS
}

// Stripe Checkout URL（将来: 実際のURLに差し替え）
export const STRIPE_CHECKOUT_URL = ''
