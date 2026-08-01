// Free プランの制限値
export const FREE_DEVICE_LIMIT  = 2    // ルーム同期を体験できる2台まで
export const FREE_ITEM_LIMIT    = 150  // 品目登録の上限
export const FREE_HISTORY_COUNT = 3    // 閲覧できる過去（完了済み）セッション数 = 直近3回

// Pro Reviewは専用Pages buildだけで有効にする。2変数の完全一致を要求し、
// URL parameterやlocalStorageからは切り替えられない。
export function isProReviewEnvironment(env = import.meta.env) {
  return env?.VITE_DEPLOYMENT_CHANNEL === 'pro-review'
    && env?.VITE_REVIEW_PLAN === 'pro'
}

// 初回公開では恒久無料枠だけを提供する。通常buildは常にfalse。
// 将来のStripe導入時は、サーバーのentitlementへ置き換える。
export function isPro() {
  return isProReviewEnvironment()
}

// 接続デバイス数チェック（Freeは2台まで）
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
