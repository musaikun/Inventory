export function _now() { return new Date().toISOString() }

export function _genShopCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('')
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
