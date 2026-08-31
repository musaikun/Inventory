// Free プランの制限値
export const FREE_DEVICE_LIMIT  = 2    // ルーム同期を体験できる2台まで
export const FREE_ITEM_LIMIT    = 150  // 品目登録の上限
export const FREE_HISTORY_COUNT = 3    // 閲覧できる過去（完了済み）セッション数 = 直近3回

/**
 * 無料枠の上限を実際に効かせるか。
 *
 * **2026-08-30、User の判断で一時的に off にしている**（実運用が先に来たため、
 * 150品目・2台・履歴3回で現場が止まらないようにする）。
 * 上の3つの値と判定ロジックはそのまま残してあるので、**戻すのはここを true にするだけ**。
 *
 * 料金設計の決定ではなく運用上の一時措置。上限を戻すかどうかは PM 判断
 * （→ docs/proposals.md）。
 *
 * サーバーは無料枠を強制していない（worker/src/entitlements.js のコメント参照）ので、
 * これを off にすると上限は**どこにも無い**状態になる。
 */
const DEFAULT_LIMITS_ENFORCED = false

let _enforced = DEFAULT_LIMITS_ENFORCED

/**
 * テスト用の切り替え。上限そのものを消してしまうと「上限が正しく効くか」を
 * 検証できなくなるため、判定ロジックは残したまま効かせた状態を作れるようにする。
 * 引数なしで既定へ戻る。
 */
export function setFreeLimitsEnforced(on = DEFAULT_LIMITS_ENFORCED) { _enforced = !!on }

/** 上限を効かせるか。Pro は常に無制限。 */
export function limitsEnforced() { return _enforced && !isPro() }

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
  if (!limitsEnforced()) return true
  return currentParticipantCount < FREE_DEVICE_LIMIT
}

// 品目を追加できるか（Freeは150品目まで）
export function canAddItem(currentItemCount) {
  if (!limitsEnforced()) return true
  return currentItemCount < FREE_ITEM_LIMIT
}

// Freeプランで残り何品目登録できるか（上限が無ければ Infinity）
export function remainingItemSlots(currentItemCount) {
  if (!limitsEnforced()) return Infinity
  return Math.max(0, FREE_ITEM_LIMIT - currentItemCount)
}

/** 登録できる品目数の上限（取込の切り詰めに使う）。上限が無ければ Infinity。 */
export function itemLimit() {
  return limitsEnforced() ? FREE_ITEM_LIMIT : Infinity
}

/** 一覧に出す過去セッション数の上限。上限が無ければ Infinity。 */
export function historyLimit() {
  return limitsEnforced() ? FREE_HISTORY_COUNT : Infinity
}
