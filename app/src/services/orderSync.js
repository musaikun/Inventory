// 発注数のルーム同期にまつわる純関数（副作用なし・テスト容易化のため App.vue から分離）。
// orderDraft の1エントリ = { orderQty, stock, unit, lot }。DO 側の orders エントリ =
// { orderQty, unit, lot, enteredBy, enteredById, updatedAt }。stock は在庫チャネル側で
// 保持するため同期ペイロードには含めない（ローカル下書きの stock は保全する）。
//
// 「保留」= 在庫は数えたが、発注数はまだ決めていない行（orderQty 0 + stock あり）。
// 実運用では棚の前で適正な発注量まで判断できないことが多く、在庫だけ記録して後から
// 詳しい人や社内の入出庫情報と突き合わせて決める。以前は orderQty 0 の行を落として
// いたため、**後で見たい品目ほど発注一覧から消えていた**。保留は下書きに残す。

/** 在庫を数えてある行か（発注数がいくつかは問わない） */
export function hasCountedStock(d) {
  return !!d && d.stock != null && Number.isFinite(Number(d.stock))
}
/** 在庫だけ入っていて、発注数がまだ決まっていない行か */
export function isPendingLine(d) {
  return hasCountedStock(d) && !(Number(d.orderQty) > 0)
}

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
  // 保留はこの端末だけが持っている（同期ペイロードに発注数0は載らない）。
  // サーバ側のスナップショットで上書きすると、数えた在庫ごと消える。
  for (const [item, d] of Object.entries(prevDraft || {})) {
    if (!next[item] && hasCountedStock(d)) next[item] = { ...d, orderQty: 0 }
  }
  return next
}

// リモートの1品目更新を下書きへ反映（他フィールドは既存値を引き継ぐ）。
// orderQty<=0 は取り消し（該当品目を落とす）。
export function applyOrderLine(prevDraft = {}, ingredient, { orderQty, unit, lot, by } = {}) {
  const next = { ...prevDraft }
  const prev = prevDraft[ingredient]
  if (Number(orderQty) > 0) {
    next[ingredient] = {
      orderQty: Number(orderQty),
      stock:    prev?.stock ?? null,
      unit:     unit || prev?.unit || '',
      lot:      lot ?? prev?.lot ?? 1,
      by:       by ?? prev?.by ?? '',
    }
  } else if (hasCountedStock(prev)) {
    // 発注は取り消されたが、数えた在庫は残す。もう一度数えに行かせない。
    next[ingredient] = { ...prev, orderQty: 0 }
  } else {
    delete next[ingredient]
  }
  return next
}

// 下書き → session_start で DO へ送る orders ペイロード。発注数>0 のみ。
// 保留（発注数0）は載せない。DO の orders は「発注する数」を配るチャネルで、
// 在庫は在庫チャネルが配る。保留は端末内の下書きに留める。
export function orderDraftToPayload(draft = {}, enteredBy = '') {
  const out = {}
  for (const [item, d] of Object.entries(draft || {})) {
    if (d && Number(d.orderQty) > 0) {
      out[item] = { orderQty: Number(d.orderQty), unit: d.unit || '', lot: d.lot ?? 1, enteredBy }
    }
  }
  return out
}
