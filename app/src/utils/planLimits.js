// Free プランの制限値
export const FREE_DEVICE_LIMIT  = 3    // ルーム同期は使えるが3台まで
export const FREE_ITEM_LIMIT    = 150  // 品目登録の上限
export const FREE_HISTORY_COUNT = 1    // 閲覧できる過去（完了済み）セッション数 = 直近1回

// localStorage にプロプランフラグが立っているか（将来のStripe連携用）
export function isPro() {
  return localStorage.getItem('tanaoro_is_pro') === '1'
}

// 接続デバイス数チェック（Freeは3台まで）
export function canJoinRoom(currentParticipantCount) {
  if (isPro()) return true
  return currentParticipantCount < FREE_DEVICE_LIMIT
}

// 品目を追加できるか（Freeは150品目まで）
export function canAddItem(currentItemCount) {
  if (isPro()) return true
  return currentItemCount < FREE_ITEM_LIMIT
}

// Freeプランで残り何品目登録できるか（PROは Infinity）
export function remainingItemSlots(currentItemCount) {
  if (isPro()) return Infinity
  return Math.max(0, FREE_ITEM_LIMIT - currentItemCount)
}

// Stripe Checkout URL（将来: 実際のURLに差し替え）
export const STRIPE_CHECKOUT_URL = ''
