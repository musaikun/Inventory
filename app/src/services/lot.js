// 入数（LOT）ユーティリティ。純関数・副作用なし。
// 入数は表示用に "24本" 等の文字列で保持されるため、発注計算に使う数値を取り出す。

export const LOT_FALLBACK = 1

// 文字列/数値から入数の数値を取り出す。取り出せなければ null。
// "24本" → 24 / "1.5kg" → 1.5 / 24 → 24 / "本" → null
export function parseLot(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  const m = String(raw).match(/\d+(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

// 発注計算で必ず使える LOT。入数不明なら 1（在庫単位＝発注単位）。
export function effectiveLot(raw) {
  return parseLot(raw) ?? LOT_FALLBACK
}
