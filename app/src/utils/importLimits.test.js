/**
 * IMPORT-001 — 取込の数量・単価上限が Worker の契約と同じ値であることを固定する。
 *
 * Worker 側（`worker/src/constants.js`）は**読み取り専用の正本**。
 * App 側が上限を持たないと、画面では「取り込めました」と出たあとにサーバーが
 * 400 を返し、複数日・複数行の取込が途中で割れる。値がずれても同じことが起きるので、
 * 定数そのものを突き合わせる（片方だけ変えたらここが落ちる）。
 */
import { describe, it, expect } from 'vitest'
import {
  IMPORT_MAX_INVENTORY_QTY, IMPORT_MAX_MOVEMENT_QTY,
  IMPORT_MAX_REORDER_POINT, IMPORT_MAX_UNIT_PRICE,
} from './importLimits.js'
import {
  MAX_INVENTORY_QTY, MAX_MOVEMENT_QTY, MAX_ORDER_QTY, MAX_UNIT_PRICE,
} from '../../../worker/src/constants.js'

describe('Worker の現行契約と同じ上限を使う', () => {
  it('棚卸数量', () => {
    expect(IMPORT_MAX_INVENTORY_QTY).toBe(MAX_INVENTORY_QTY)
    expect(IMPORT_MAX_INVENTORY_QTY).toBe(1_000_000)
  })

  it('入出庫数量', () => {
    expect(IMPORT_MAX_MOVEMENT_QTY).toBe(MAX_MOVEMENT_QTY)
    expect(IMPORT_MAX_MOVEMENT_QTY).toBe(1_000_000)
  })

  it('発注点は数量として発注数と同じ上限', () => {
    expect(IMPORT_MAX_REORDER_POINT).toBe(MAX_ORDER_QTY)
    expect(IMPORT_MAX_REORDER_POINT).toBe(1_000_000)
  })

  it('単価', () => {
    expect(IMPORT_MAX_UNIT_PRICE).toBe(MAX_UNIT_PRICE)
    expect(IMPORT_MAX_UNIT_PRICE).toBe(100_000_000)
  })
})
