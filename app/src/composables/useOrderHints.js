// 発注の数量入力（ConfirmModal の発注モード）に添える参考値。
// 適正在庫・前週同曜の発注数・同曜の発注履歴・理論在庫・補充目標を、品目ごとに1回で引く。
//
// もとは App.vue の中にあった。数字の出し方そのものは services/（orderLearning・orderBase・
// orderItemHistory・theoreticalStock）が持ち、ここは店のデータを集めて渡すだけにする。
import { useConfig } from './useConfig.js'
import { useHistory } from './useHistory.js'
import { useOrders } from './useOrders.js'
import { useMovements } from './useMovements.js'
import { useDayNotes } from './useDayNotes.js'
import { localDateKey } from '../utils/localDate.js'
import { parLevel as calcParLevel, weekdayOf } from '../services/orderLearning.js'
import { orderBaseFor } from '../services/orderBase.js'
import { allOrderDays, orderIntervalDays } from '../services/orderScheduleUtil.js'
import { weekdayOrderHistory } from '../services/orderItemHistory.js'
import { theoreticalStock } from '../services/theoreticalStock.js'

export function useOrderHints() {
  const { config } = useConfig()
  const { getSnapshots } = useHistory()
  const { getOrders, getLearningEvents } = useOrders()
  const { getMovements } = useMovements()
  const { isExcluded: _isDateExcluded } = useDayNotes()

  // 発注の日付・曜日学習の「今日」。UTC だと日本時間の朝9時まで前日になり、完了した発注が昨日のマスに入っていた
  const _todayStr = () => localDateKey()

  // この品目・今日の曜日の適正在庫（学習不足なら null）。
  // 日別メモで「学習から除外」した異常日（貸切・イベント等）は par 学習から外す。
  function _parLevelFor(item) {
    const events = getLearningEvents().filter(e => !_isDateExcluded(e.date))
    return calcParLevel(events, item, weekdayOf(_todayStr()))
  }
  // 理論在庫（直近棚卸＋入出庫の導出値）。発注時の在庫入力の参考・ズレ検出用。
  function _theoStockFor(item) {
    return theoreticalStock(item, getSnapshots(), getMovements())
  }
  // 補充目標（発注してここまで戻す水準）と、その根拠。
  // 発注点はトリガーであって目標ではないので、目標は別に決める（services/orderBase）。
  // 学習（適正在庫）が貯まらない部分利用でも、発注点さえ入っていれば推奨が出る。
  // 発注間隔・発注曜日は「店舗としていつ発注が入るか」で決まる。スケジュールが複数あっても
  // 品目とスケジュールの紐付けはまだ無いので、全スケジュールの曜日の和集合で扱う。
  function _replenishFor(item) {
    return orderBaseFor(item, {
      reorderPoints: config.reorderPoints ?? {}, replenishTargets: config.replenishTargets ?? {},
      assumptions: config.orderAssumptions ?? null, category: config.categories?.[item] ?? '',
      snapshots: getSnapshots(), orders: getOrders(), movements: getMovements(),
      orderDays: allOrderDays(config.orderSchedules), horizonDays: orderIntervalDays(config.orderSchedules),
      parLevel: _parLevelFor(item),
    }).target
  }
  // 前週同曜日の発注数（参考表示用）。同曜日で最も新しい発注行の qty。
  function _lastWeekQtyFor(item) {
    const wd = weekdayOf(_todayStr())
    let best = null
    for (const o of getOrders()) {
      if (weekdayOf(o.date) !== wd) continue
      const line = (o.lines || []).find(l => l.item === item)
      if (line && (!best || o.date > best.date)) best = { date: o.date, qty: line.qty }
    }
    return best ? best.qty : null
  }
  // 品目×同曜の発注履歴（前週・先月・直近中央値・推移）。当日分は除外。
  function _weekdayHistoryFor(item) {
    return weekdayOrderHistory(getOrders(), item, weekdayOf(_todayStr()), { window: 6, before: _todayStr() })
  }

  function orderHintsFor(item) {
    return {
      parLevel:       _parLevelFor(item),
      lastWeekQty:    _lastWeekQtyFor(item),
      weekdayHistory: _weekdayHistoryFor(item),
      theoStock:      _theoStockFor(item),
      replenish:      _replenishFor(item),
    }
  }

  return { orderHintsFor }
}
