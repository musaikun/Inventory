// 店舗のプラン／トライアル状態の算出（純関数・サーバーが正）。
// クライアントの localStorage フラグではなく、この結果を UI 表示と将来のゲートの根拠にする。
//
// ※ 現状は「算出」まで。無料/有料の具体的な機能ゲート（品目マスタ管理・入出庫のみ開放、
//    AI取込を含めるか等）は未確定のため、確定後にここを参照して enforcement を追加する。

import { TRIAL_DAYS } from './constants.js'

const DAY_MS = 86_400_000

/**
 * @param {object} store { plan?: 'free'|'pro', created_at?: ISO文字列 }
 * @param {number} now   現在時刻(ms)。テスト用に注入可能
 * @returns {{ plan:'free'|'pro', inTrial:boolean, trialEndsAt:string, isPro:boolean }}
 */
export function entitlement(store, now = Date.now()) {
  const plan = store?.plan === 'pro' ? 'pro' : 'free'
  const createdMs = store?.created_at ? new Date(store.created_at).getTime() : now
  const base = Number.isFinite(createdMs) ? createdMs : now
  const trialEndsMs = base + TRIAL_DAYS * DAY_MS
  const inTrial = now < trialEndsMs
  return {
    plan,
    inTrial,
    trialEndsAt: new Date(trialEndsMs).toISOString(),
    isPro: plan === 'pro' || inTrial,
  }
}
