/**
 * 取込の数量・単価の上限（IMPORT-001）。
 *
 * 値の正本は **Worker の `worker/src/constants.js`**（読み取り専用）。ここは同じ契約を
 * client 側へ写したものであって、App が独自に決める上限ではない。
 *
 * client に上限が無いと、画面のプレビューは「取り込めます」と出したあとに
 * サーバーが 400 を返す。過去棚卸取込は 1日 = 1リクエストなので、
 * 途中の日だけ落ちて「一部だけ入った」状態がユーザーの手元に残る。
 * 確定前に同じ基準で弾けば、その状態を作らない。
 *
 * **Worker が上限を持たない項目へ、ここで勝手に上限を足さない。**
 * （入数・前月実績・分類コードは worker 側に数値契約が無いため対象外）
 */

/** 棚卸数量（worker: MAX_INVENTORY_QTY） */
export const IMPORT_MAX_INVENTORY_QTY = 1_000_000

/** 入出庫数量（worker: MAX_MOVEMENT_QTY） */
export const IMPORT_MAX_MOVEMENT_QTY = 1_000_000

/** 発注点は発注数と同じ数量の上限（worker: MAX_ORDER_QTY） */
export const IMPORT_MAX_REORDER_POINT = 1_000_000

/** 単価（円・worker: MAX_UNIT_PRICE） */
export const IMPORT_MAX_UNIT_PRICE = 100_000_000
