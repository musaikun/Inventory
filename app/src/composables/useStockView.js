// 理論在庫（直近の棚卸＋入庫−出庫）・発注基準・要補充の判定。
// 仕入れの「在庫」タブと「品目・在庫」ページで同じ数字を出すために共通化した。
// 呼ぶたびに computed を作るので、ページ（コンポーネント）の setup で1回だけ呼ぶ。
import { ref, computed } from 'vue'
import { useConfig } from './useConfig.js'
import { useHistory } from './useHistory.js'
import { useMovements } from './useMovements.js'
import { useOrders } from './useOrders.js'
import { allOrderDays, orderIntervalDays } from '../services/orderScheduleUtil.js'
import { theoreticalStock } from '../services/theoreticalStock.js'
import { suggestReorderPoint } from '../services/reorderSuggestion.js'
import { orderBaseFor } from '../services/orderBase.js'
import { itemConsumptionAvailability, storeConsumptionReadiness } from '../services/analysisCapability.js'
import { parseLot } from '../services/lot.js'

export function useStockView() {
  const { config } = useConfig()
  const { getSnapshots } = useHistory()
  const { getMovements } = useMovements()
  const { getOrders } = useOrders()

  const hiddenSet = computed(() => new Set(config.hiddenItems || []))
  const allItems = computed(() => (config.order || []).filter(n => !hiddenSet.value.has(n)))

  // 発注点（手動設定）。未設定は null。
  function reorderOf(item) {
    const v = Number(config.reorderPoints?.[item])
    return Number.isFinite(v) && v >= 0 ? v : null
  }
  // 要補充判定: 発注点を手で入れた品目だけ「理論在庫 ≤ 発注点」（User決定 2026-10-03）。
  // 発注点の無い品目は、見込みが0でも要補充にしない（自動の仮・実績は発注点の画面の目安で、ここでは数えない）
  function needsReorder(item) {
    const rp = reorderOf(item)
    if (rp == null) return false
    const t = theoOf(item)
    return t != null && t <= rp
  }

  // 要補充の件数 — 進捗表示用
  const reorderCount = computed(() => allItems.value.reduce((n, item) => n + (needsReorder(item) ? 1 : 0), 0))
  // 発注点を手で入れた品目の数。0なら在庫タブに要補充のチップを出さない
  const reorderSetCount = computed(() => allItems.value.reduce((n, item) => n + (reorderOf(item) != null ? 1 : 0), 0))

  // その品目に関わる直近の入出庫（新しい順・最大6件）
  function itemMovements(item) {
    const out = []
    for (const mv of getMovements()) {   // 既に date 降順
      const line = (mv.lines || []).find(l => l.item === item)
      if (line) out.push({ id: mv.id, date: mv.date, type: mv.type, qty: line.qty, unit: line.unit, note: mv.note })
      if (out.length >= 6) break
    }
    return out
  }

  // ゲート表示: 算出に必要なデータが揃わない場合のヒント（過去棚卸の取込を促す）
  function consumptionHintOf(item) {
    return itemConsumptionAvailability(item, {
      snapshots: _snaps.value, orders: getOrders(), movements: _moves.value,
      orderDays: schedOrderDays.value,
    }).hint
  }
  const storeReadiness = computed(() => storeConsumptionReadiness({ snapshots: _snaps.value }))
  // 消費推定・補充目標は「店舗としていつ発注が入るか」で決まる。スケジュールが複数あっても
  // 品目とスケジュールの紐付けはまだ無いので、全スケジュールの曜日の和集合で扱う。
  const schedOrderDays = computed(() => allOrderDays(config.orderSchedules))
  const reorderHorizon = computed(() => orderIntervalDays(config.orderSchedules))
  // 発注基準（発注点・補充目標）。手動 → 学習/消費 → 仮 の順は services/orderBase に集約。
  // 仮定（config.orderAssumptions）が無い店は従来どおり手動の発注点だけで決まる。
  const baseMap = computed(() => {
    const ctx = {
      reorderPoints: config.reorderPoints ?? {}, replenishTargets: config.replenishTargets ?? {},
      assumptions: config.orderAssumptions ?? null,
      snapshots: _snaps.value, orders: getOrders(), movements: _moves.value,
      orderDays: schedOrderDays.value, horizonDays: reorderHorizon.value,
    }
    const m = {}
    for (const item of allItems.value) m[item] = orderBaseFor(item, { ...ctx, category: config.categories?.[item] ?? '' })
    return m
  })
  function baseOf(item) {
    return baseMap.value[item] ?? { reorder: null, target: null }
  }
  // 補充目標（発注してここまで戻す）。発注点はトリガーなので目標は別に決める。
  function replenishOf(item) { return baseOf(item).target }

  // 発注点の目安（詳細シートの「目安」）。仮定がある店では仮も出す。
  function reorderSuggestionOf(item) {
    return suggestReorderPoint(item, {
      snapshots: _snaps.value, orders: getOrders(), movements: _moves.value,
      orderDays: schedOrderDays.value, horizonDays: reorderHorizon.value,
      assumptions: config.orderAssumptions ?? null, category: config.categories?.[item] ?? '',
    })
  }
  function suggestedReorder(item) { return reorderSuggestionOf(item)?.value ?? null }
  function suggestBasisLabel(item) { return reorderSuggestionOf(item)?.basis ?? '' }

  // ── 理論在庫（全品目を一括算出）─────────────────────────────
  const _snaps = computed(() => getSnapshots())
  const _moves = computed(() => getMovements())
  const stockMap = computed(() => {
    const snaps = _snaps.value, moves = _moves.value
    const m = {}
    for (const item of allItems.value) m[item] = theoreticalStock(item, snaps, moves)
    return m
  })
  function theoOf(item) { return stockMap.value[item]?.qty ?? null }
  function unitOf(item) { return config.units?.[item] ?? '' }
  function _md(d) {
    const [, mo, dd] = String(d || '').split('-').map(Number)
    return mo && dd ? `${mo}/${dd}` : ''
  }
  function basisLabel(item) {
    const t = stockMap.value[item]
    if (!t) return '記録なし'
    const parts = [t.baseDate ? `${_md(t.baseDate)}棚卸 ${t.baseQty}` : '棚卸なし']
    if (t.inQty)  parts.push(`＋入庫${t.inQty}`)
    if (t.outQty) parts.push(`−出庫${t.outQty}`)
    return parts.join(' ')
  }

  // ── 入数（ケース）─────────────────────────────
  function lotOf(item) { return parseLot(config.lotSizes?.[item]) }

  // 一覧の数字に添える根拠（短く）。例: 「9/20 棚卸 8」。棚卸が無ければ null
  function baseShort(item) {
    const t = stockMap.value[item]
    return t?.baseDate ? `${_md(t.baseDate)} 棚卸 ${t.baseQty}` : null
  }

  return {
    allItems, reorderOf, needsReorder, reorderCount, reorderSetCount, itemMovements, consumptionHintOf, storeReadiness,
    schedOrderDays, reorderHorizon, baseOf, replenishOf, suggestedReorder, suggestBasisLabel,
    _snaps, _moves, stockMap, theoOf, unitOf, basisLabel, baseShort, lotOf,
  }
}
