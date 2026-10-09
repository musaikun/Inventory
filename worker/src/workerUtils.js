export function _now() { return new Date().toISOString() }

// 店舗コードはログインと部屋の入口を兼ねるので、予測できない乱数（crypto）で作る。
// 1バイトを24文字へ割り当てるとき、240 以上は捨てて引き直す（剰余の偏りを出さない）。
export function _genShopCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const out = []
  while (out.length < 6) {
    for (const b of crypto.getRandomValues(new Uint8Array(8))) {
      if (b < 240 && out.length < 6) out.push(c[b % c.length])
    }
  }
  return out.join('')
}

// 既存店舗と衝突しない店舗コードを発行する（register / store-create 共通）
export async function genUniqueShopCode(db) {
  let code, existing
  do {
    code     = _genShopCode()
    existing = await db.prepare('SELECT shop_code FROM stores WHERE shop_code = ?').bind(code).first()
  } while (existing)
  return code
}
