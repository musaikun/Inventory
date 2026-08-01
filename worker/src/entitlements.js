// 店舗のプラン状態の算出（純関数・サーバーが正）。
// クライアントの localStorage フラグではなく、この結果を UI 表示と将来のゲートの根拠にする。
//
// 初回公開は恒久無料枠で、14日トライアルや自動課金は行わない。
// inTrial / trialEndsAt は既存APIとの互換のため false / null で残す。
// 無料枠のサーバー強制は、Stripe導入前のentitlement配線で追加する。

/**
 * @param {object} store { plan?: 'free'|'pro' }
 * @returns {{ plan:'free'|'pro', inTrial:false, trialEndsAt:null, isPro:boolean }}
 */
export function entitlement(store) {
  const plan = store?.plan === 'pro' ? 'pro' : 'free'
  return {
    plan,
    inTrial: false,
    trialEndsAt: null,
    isPro: plan === 'pro',
  }
}
