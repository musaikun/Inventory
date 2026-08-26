/**
 * 変更履歴（操作ログ）から、参加者別の集計と品目ごとの履歴を作る。
 *
 * ## 数え方
 *
 * 「それぞれの参加者が何品目登録したか」は **操作単位で数える（重複あり）**。
 * 品目Aを登録したあと別の担当者が同じ品目Aを変更したら、**それぞれ1件**として数える。
 * 見たいのは「誰がどれだけ手を動かしたか」なので、最終的な担当者だけを数えない。
 *
 * 金額は逆に重複させられない（同じ品目を2人ぶん足すと合計が実態と合わない）。
 * そのため金額だけは **最後に入力した人の担当**として1回だけ計上する。
 *
 * ## 正本
 *
 * 集計元は `snapshot.auditLog`。0.83.0 で 200件上限を外したので、
 * 品目数を大きく上回る操作数でも全件残る。
 * 上限があった頃のスナップショットや過去データ取込には auditLog が無い／欠けるため、
 * その場合は保存済みの `snapshot.participants`（品目ごとに最終入力者1人）へ落とす。
 */

// 数量を変える操作だけを「登録・変更」として数える。
// フラグ（あとで数える）や発注は棚卸の登録件数ではない。
const QTY_ACTIONS = new Set(['new', 'add', 'overwrite', 'remove', 'set'])

export function isQtyAction(action) {
  return QTY_ACTIONS.has(action)
}

/**
 * 監査エントリの時刻を epoch ms へ揃える。
 * server を経由すると数値が文字列（"1700000000000"）で返ることがあり、
 * `new Date(その文字列)` は Invalid Date になる。ISO 文字列も受ける。
 */
export function toEpochMs(ts) {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null
  if (typeof ts !== 'string' || ts === '') return null
  if (/^\d+$/.test(ts)) return Number(ts)
  const t = new Date(ts).getTime()
  return Number.isNaN(t) ? null : t
}

const _key   = (e) => e?.enteredById || `name:${e?.enteredBy || ''}`
const _name  = (e) => e?.enteredBy || '名前未設定'

/** 品目 → その品目を触った担当キーの集合 */
function _touchedBy(log) {
  const map = new Map()
  for (const e of log) {
    if (!isQtyAction(e?.action)) continue
    if (!map.has(e.ingredient)) map.set(e.ingredient, new Set())
    map.get(e.ingredient).add(_key(e))
  }
  return map
}

/**
 * 参加者別の集計。件数の多い順。
 *
 * @returns [{ id, name, count, itemCount, sharedCount, activeMs, totalValue, entries }]
 *   count       … 登録・変更の操作件数（重複あり）
 *   itemCount   … 触った品目の数（重複なし）
 *   sharedCount … そのうち他の担当者も触った品目の数
 *   entries     … 時系列（古い順）。shared = 他の担当者も触った品目
 */
export function participantStats(snapshot) {
  const log = Array.isArray(snapshot?.auditLog) ? snapshot.auditLog : []
  const ops = log.filter(e => isQtyAction(e?.action) && e?.ingredient)
  if (ops.length === 0) return _fromStoredParticipants(snapshot)

  const shared = _touchedBy(log)
  const priceOf = _priceMap(snapshot)
  const lastOwner = new Map()   // 品目 → 最後に入力した担当キー
  for (const e of ops) lastOwner.set(e.ingredient, _key(e))

  const byPerson = new Map()
  for (const e of ops) {
    const id = _key(e)
    if (!byPerson.has(id)) {
      byPerson.set(id, { id, name: _name(e), entries: [], items: new Set(), sharedItems: new Set() })
    }
    const p = byPerson.get(id)
    p.name = _name(e)   // 名前が途中で変わった場合は新しい方を採る
    const isShared = (shared.get(e.ingredient)?.size ?? 0) > 1
    p.entries.push({
      item:   e.ingredient,
      qty:    e.totalQty ?? null,
      unit:   e.unit ?? '',
      action: e.action,
      at:     toEpochMs(e.timestamp),
      shared: isShared,
    })
    p.items.add(e.ingredient)
    if (isShared) p.sharedItems.add(e.ingredient)
  }

  const out = []
  for (const p of byPerson.values()) {
    p.entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    const times = p.entries.map(e => e.at).filter(t => typeof t === 'number' && t > 0)
    let totalValue = null
    for (const item of p.items) {
      if (lastOwner.get(item) !== p.id) continue      // 金額は最終担当ぶんだけ
      const v = priceOf.get(item)
      if (v != null) totalValue = (totalValue ?? 0) + v
    }
    out.push({
      id: p.id,
      name: p.name,
      count: p.entries.length,
      itemCount: p.items.size,
      sharedCount: p.sharedItems.size,
      activeMs: times.length >= 2 ? Math.max(...times) - Math.min(...times) : null,
      totalValue,
      entries: p.entries,
    })
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
}

/** 品目 → 小計（金額の無い棚卸では空） */
function _priceMap(snapshot) {
  const m = new Map()
  for (const it of (snapshot?.items ?? [])) {
    if (it?.subtotal != null) m.set(it.item, it.subtotal)
  }
  return m
}

/** auditLog が無い古い履歴・過去データ取込用の落としどころ */
function _fromStoredParticipants(snapshot) {
  return (snapshot?.participants ?? []).map((p, i) => {
    const entries = (p.items ?? []).map(it => ({
      item: it.item, qty: it.qty ?? null, unit: it.unit ?? '',
      action: null, at: toEpochMs(it.at), shared: false,
    }))
    const times = entries.map(e => e.at).filter(t => typeof t === 'number' && t > 0)
    return {
      id: `stored-${i}`,
      name: p.name || '名前未設定',
      count: entries.length,
      itemCount: entries.length,
      sharedCount: 0,
      activeMs: times.length >= 2 ? Math.max(...times) - Math.min(...times) : null,
      totalValue: p.totalValue ?? null,
      entries,
      approximate: true,   // 操作単位ではなく品目単位（重複を数えられていない）
    }
  })
}

/**
 * 1品目の変更履歴（新しい順）。品目一覧から選んだときに出す。
 * タイムスタンプでのベタ書きでは追いにくい「この品目に何が起きたか」を1画面にする。
 */
export function itemHistory(snapshot, item) {
  const log = Array.isArray(snapshot?.auditLog) ? snapshot.auditLog : []
  return log
    .filter(e => e?.ingredient === item)
    .map(e => ({
      id: e.id,
      action: e.action,
      qty: e.totalQty ?? null,
      delta: e.delta ?? null,
      unit: e.unit ?? '',
      by: _name(e),
      byId: _key(e),
      at: toEpochMs(e.timestamp),
    }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** 品目 → 触った担当者数。一覧で「複数人が触った品目」を色分けするのに使う */
export function sharedItemCounts(snapshot) {
  const log = Array.isArray(snapshot?.auditLog) ? snapshot.auditLog : []
  const out = {}
  for (const [item, people] of _touchedBy(log)) out[item] = people.size
  return out
}
