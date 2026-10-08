/**
 * 金額（単価・小計・在庫金額）を見られない人への応答と、その人からの保存の扱い（段 2-3 の money）。
 *
 * 画面で金額を隠すだけでは、アルバイトのトークンで API を直接呼べば単価が読める。
 * そこでサーバーが応答から金額を落とす。ただし落とした応答を受け取った端末は、
 * そのまま保存し直してくる（config は丸ごと PUT、履歴は訂正・ロックで丸ごと POST）。
 * そのまま書くと店の単価や在庫金額が消えるので、保存のときに前の値から戻す。
 *
 * 落とし方は RoomDO のゲスト向けと同じ（config.prices は {}、それ以外の金額は null）。
 * 端末は `unitPrice != null` などで判定しているので、null なら「金額なし」として動く。
 */

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const _arr = v => (Array.isArray(v) ? v : [])

/** config から単価を落としたコピー */
export function stripConfigMoney(config) {
  const c = _obj(config)
  if (!c) return config
  return { ...c, prices: {} }
}

/** 金額を見られない人の config 保存: 単価は送られてきた値を採らず、前の値のまま残す */
export function restoreConfigMoney(prev, next) {
  const n = _obj(next)
  if (!n) return next
  return { ...n, prices: { ...(_obj(_obj(prev)?.prices) ?? {}) } }
}

/** 履歴スナップショット（GET /history の1件）から金額を落としたコピー */
export function stripSnapshotMoney(snap) {
  const s = _obj(snap)
  if (!s) return snap
  const out = { ...s, totalValue: null }
  if (Array.isArray(s.items)) out.items = s.items.map(it => (_obj(it) ? { ...it, unitPrice: null, subtotal: null } : it))
  if (Array.isArray(s.participants)) {
    out.participants = s.participants.map(p => {
      if (!_obj(p)) return p
      const q = { ...p, totalValue: null }
      if (Array.isArray(p.items)) q.items = p.items.map(it => (_obj(it) ? { ...it, subtotal: null } : it))
      return q
    })
  }
  return out
}

/** 明細（GET /sessions/:id/lines）から金額を落としたコピー */
export function stripLinesMoney(result) {
  const r = _obj(result)
  if (!r || r._status) return result
  const out = { ...r, totalValue: null }
  if (Array.isArray(r.lines)) out.lines = r.lines.map(l => (_obj(l) ? { ...l, unitPrice: null, subtotal: null } : l))
  return out
}

const _sameQty = (a, b) => (a ?? null) === (b ?? null)
const _lineValue = (qty, price) => (qty != null && price != null ? Math.round(qty * price) : null)

/**
 * 金額を見られない人の履歴保存: 金額は前の版（サーバーにある版）から戻す。
 *
 * - 単価は品目名で前の版から戻す。前の版に無い品目は null（その人は単価を知らない）。
 * - 小計は数量が変わっていなければ前の値、変わっていれば 単価×数量 を四捨五入
 *   （端末の訂正 `patchSnapshotItems` と、完了時の `inventoryLineStatements` と同じ式）。
 * - 在庫金額は品目の数量が1つも変わっていなければ前の値、変わっていれば小計の合計
 *   （小計が1つも無ければ null。端末の訂正と同じ規則）。
 * - 参加者別の金額は、名前と品目名で前の版の値を戻す。
 * 前の版が無ければ、金額はすべて null（送られてきた値は採らない）。
 */
export function restoreSnapshotMoney(prev, next) {
  const n = _obj(next)
  if (!n) return next
  const p = _obj(prev) ?? {}
  const prevItems = new Map(_arr(p.items).filter(_obj).map(it => [it.item, it]))

  let changed = false
  const items = Array.isArray(n.items) ? n.items.map(it => {
    if (!_obj(it)) return it
    const before = prevItems.get(it.item)
    const unitPrice = before?.unitPrice ?? null
    const same = !!before && _sameQty(before.qty, it.qty)
    if (!same) changed = true
    const subtotal = same ? (before.subtotal ?? null) : _lineValue(it.qty ?? null, unitPrice)
    return { ...it, unitPrice, subtotal }
  }) : n.items
  if (_arr(n.items).length !== prevItems.size) changed = true

  let totalValue
  if (!changed) {
    totalValue = p.totalValue ?? null
  } else {
    let total = 0, has = false
    for (const it of _arr(items)) {
      if (_obj(it) && it.qty != null && it.subtotal != null) { total += it.subtotal; has = true }
    }
    totalValue = has ? total : null
  }

  const out = { ...n, totalValue }
  if (Array.isArray(n.items)) out.items = items
  if (Array.isArray(n.participants)) {
    const prevPeople = new Map(_arr(p.participants).filter(_obj).map(x => [x.name, x]))
    out.participants = n.participants.map(x => {
      if (!_obj(x)) return x
      const before = prevPeople.get(x.name)
      const beforeItems = new Map(_arr(before?.items).filter(_obj).map(it => [it.item, it]))
      const q = { ...x, totalValue: before?.totalValue ?? null }
      if (Array.isArray(x.items)) {
        q.items = x.items.map(it => (_obj(it) ? { ...it, subtotal: beforeItems.get(it.item)?.subtotal ?? null } : it))
      }
      return q
    })
  }
  return out
}
