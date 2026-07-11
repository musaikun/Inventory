/**
 * 品目リスト（config）のフィールド定義を一元管理する。
 * useConfig の保存/復元、App.vue の D1/WS 送信、RoomDO の保存が
 * すべて同じフィールドセットを扱うための唯一の定義箇所。
 * フィールドを追加するときはここに1行足すだけでよい。
 */
export function emptyConfigFields() {
  return {
    order:         [],
    units:         {},
    prices:        {},
    categories:    {},
    codes:         {},
    categoryCodes: {},
    prevMonths:    {},
    lotSizes:      {},
    dictionary:    {},
    manualItems:   [],
    axisNames:     ['', ''],
    tagsA:         {},
    tagsB:         {},
    axisGroupsA:   [],
    axisGroupsB:   [],
    hiddenItems:   [],
  }
}

export const CONFIG_FIELD_KEYS = Object.keys(emptyConfigFields())

/** config から同期対象フィールドだけを抜き出す（値は参照のまま） */
export function pickConfigFields(src) {
  const out = {}
  for (const k of CONFIG_FIELD_KEYS) out[k] = src[k]
  return out
}

/** D1 保存・WS ブロードキャスト用ペイロード（manualItems はローカル専用のため除外） */
export function syncConfigPayload(config) {
  const { manualItems, ...fields } = pickConfigFields(config)
  return { ...fields, isCustom: config.isCustom }
}
