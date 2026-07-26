// 発注数のルーム同期にまつわる純関数（副作用なし・テスト容易化のため App.vue から分離）。
// orderDraft の1エントリ = { orderQty, stock, unit, lot }。DO 側の orders エントリ =
// { orderQty, unit, lot, enteredBy, enteredById, updatedAt }。stock は在庫チャネル側で
// 保持するため同期ペイロードには含めない（ローカル下書きの stock は保全する）。

// DO の orders スナップショットを下書きへ揃える。発注数>0 の品目だけ残し、
// ローカルに持っていた stock は品目ごとに引き継ぐ（在庫は別ルートで同期されるため）。
export function mergeOrderSnapshot(prevDraft = {}, serverOrders = {}) {
  const next = {}
  if (serverOrders && typeof serverOrders === 'object') {
    for (const [item, d] of Object.entries(serverOrders)) {
      if (d && Number(d.orderQty) > 0) {
        next[item] = {
          orderQty: Number(d.orderQty),
          stock:    prevDraft?.[item]?.stock ?? null,
          unit:     d.unit || '',
          lot:      d.lot ?? 1,
          by:       d.enteredBy || '',
        }
      }
    }
  }
  return next
}

// リモートの1品目更新を下書きへ反映（他フィールドは既存値を引き継ぐ）。
// orderQty<=0 は取り消し（該当品目を落とす）。
export function applyOrderLine(prevDraft = {}, ingredient, { orderQty, unit, lot, by } = {}) {
  const next = { ...prevDraft }
  if (Number(orderQty) > 0) {
    const prev = prevDraft[ingredient]
    next[ingredient] = {
      orderQty: Number(orderQty),
      stock:    prev?.stock ?? null,
      unit:     unit || prev?.unit || '',
      lot:      lot ?? prev?.lot ?? 1,
      by:       by ?? prev?.by ?? '',
    }
  } else {
    delete next[ingredient]
  }
  return next
}

// 下書き → session_start で DO へ送る orders ペイロード。発注数>0 のみ。
export function orderDraftToPayload(draft = {}, enteredBy = '') {
  const out = {}
  for (const [item, d] of Object.entries(draft || {})) {
    if (d && Number(d.orderQty) > 0) {
      out[item] = { orderQty: Number(d.orderQty), unit: d.unit || '', lot: d.lot ?? 1, enteredBy }
    }
  }
  return out
}
