// 古い明細の品目の ID を埋める（ITEM-001 段 I-3・2026-11-28）。
//
// 対象は item_id が NULL の行だけ（migration 0038 より前に書いた行）。I-2 以降の行は端末が ID を添えているので触らない。
// 埋める値は、その店の設定の itemIds（名前 → ID）。表に無い名前（消した品目など）は店舗コード＋名前から計算する。
// 毎時の cron で少しずつ進める（1回あたりの D1 呼び出しを有界にする）。部分 index（item_id IS NULL）で残りを探すので、
// 埋め終わった後の確認は軽い。
//
// 名前を変えた品目の古い行: 変える前の名前は表から外れるので、計算した ID（＝最初の名前から決まる ID）が入る。
// 名前を変えてから同じ名前で別の品目を作り直した場合だけ食い違いうる（I-5 の統合・名前の変更で扱う）。

import { itemIdFor, isItemId } from './itemId.js'

export const BACKFILL_TABLES = [
  { table: 'inventory_lines', name: 'item_name' },
  { table: 'session_audit',   name: 'item_name' },
  { table: 'order_lines',     name: 'item' },
  { table: 'movement_lines',  name: 'item' },
]
const NAMES_PER_UPDATE = 200          // 1文で埋める名前の数（JSON の大きさを抑える）
export const BACKFILL_STORES_PER_RUN = 2
export const BACKFILL_QUERY_BUDGET   = 20   // 1回の cron で使ってよい D1 呼び出しの数

/** item_id が NULL の行が残っている店（最大 limit 件） */
export async function storesNeedingBackfill(db, limit = BACKFILL_STORES_PER_RUN) {
  const union = BACKFILL_TABLES.map(t => `SELECT shop_code FROM ${t.table} WHERE item_id IS NULL`).join(' UNION ')
  const { results } = await db.prepare(`SELECT shop_code FROM (${union}) LIMIT ?`).bind(limit).all()
  return (results ?? []).map(r => r.shop_code)
}

/**
 * 1店ぶん埋める。budget を使い切ったら途中で止める（残りは次の回）。
 * @returns {{ updated: number, queries: number, done: boolean }}
 */
export async function backfillStoreItemIds(db, code, { budget = BACKFILL_QUERY_BUDGET } = {}) {
  let queries = 0, updated = 0
  const row = await db.prepare('SELECT config_json FROM store_configs WHERE shop_code = ?').bind(code).first()
  queries++
  let ids = {}
  try { const cfg = row ? JSON.parse(row.config_json) : null; if (cfg?.itemIds && typeof cfg.itemIds === 'object') ids = cfg.itemIds } catch (_) { /* 読めなければ計算だけで埋める */ }

  for (const { table, name } of BACKFILL_TABLES) {
    while (queries + 2 <= budget) {
      const { results } = await db.prepare(
        `SELECT DISTINCT ${name} AS n FROM ${table} WHERE shop_code = ? AND item_id IS NULL LIMIT ?`,
      ).bind(code, NAMES_PER_UPDATE).all()
      queries++
      const names = (results ?? []).map(r => r.n).filter(n => typeof n === 'string' && n)
      if (!names.length) break
      const map = JSON.stringify(Object.fromEntries(names.map(n => [n, isItemId(ids[n]) ? ids[n] : itemIdFor(code, n)])))
      const res = await db.prepare(`
        UPDATE ${table} SET item_id = (SELECT j.value FROM json_each(?) j WHERE j.key = ${table}.${name})
        WHERE shop_code = ? AND item_id IS NULL AND ${name} IN (SELECT j.key FROM json_each(?) j)
      `).bind(map, code, map).run()
      queries++
      updated += res?.meta?.changes ?? 0
      if (names.length < NAMES_PER_UPDATE) break
    }
    if (queries + 2 > budget) return { updated, queries, done: false }
  }
  return { updated, queries, done: true }
}

/** cron から呼ぶ。残っている店を少しずつ埋める */
export async function backfillItemIds(db, { stores = BACKFILL_STORES_PER_RUN, budget = BACKFILL_QUERY_BUDGET } = {}) {
  const codes = await storesNeedingBackfill(db, stores)
  let left = budget - 1, updated = 0
  for (const code of codes) {
    if (left < 3) break
    const r = await backfillStoreItemIds(db, code, { budget: left })
    left -= r.queries; updated += r.updated
  }
  return { stores: codes.length, updated }
}
