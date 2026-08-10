/**
 * 過去棚卸取込の計画と確定（IMPORT-001）。
 *
 * 以前の実装は window.confirm 1枚で、そのあと localStorage を日付キーで直接書き、
 * D1 へは投げっぱなしだった。そのため
 *   ・同じ日に通常の棚卸があると黙って上書きした
 *   ・サーバー保存の成否を見ずに「取り込みました」と表示した
 *   ・取り込んだものだけを取り消す手段が無かった
 *
 * ここでは「計画（何が起きるか）→ サーバー確定 → 端末反映」の順に分ける。
 * 計画は純粋関数で、確定は1日ずつサーバーの結果を確認しながら進める。
 */

import { newImportBatchId } from '../utils/importBatch.js'

// 同じ日に既存セッションがあるときの選択肢。既定は「別セッションとして追加」（非破壊）。
export const ON_CONFLICT_ADD     = 'add'      // 既存を残し、別セッションとして足す
export const ON_CONFLICT_REPLACE = 'replace'  // 既存を消して置き換える

/**
 * 解析済みスナップショットと既存履歴から取込計画を組み立てる。
 *
 * @param {Array}  snapshots         parseResultSnapshots の返り値 [{ date, items }]
 * @param {object} opts
 * @param {Array}  opts.existing     既存スナップショット（useHistory.getSnapshots()）
 * @param {string} [opts.importBatchId]
 * @returns {{ importBatchId, days: Array, totals: object }}
 */
export function buildPastImportPlan(snapshots, { existing = [], importBatchId } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error('取り込める棚卸データがありません')
  }

  const byDate = new Map()
  for (const s of existing) {
    if (!s?.date) continue
    if (!byDate.has(s.date)) byDate.set(s.date, [])
    byDate.get(s.date).push(s)
  }

  const days = snapshots.map(snap => {
    const items = (snap.items ?? []).filter(it => String(it?.item ?? it?.name ?? '').trim())
    let totalValue = 0
    let hasPrices  = false
    for (const it of items) {
      const qty   = Number(it.qty)
      const price = it.unitPrice ?? it.price
      if (Number.isFinite(qty) && price != null && price !== '' && Number.isFinite(Number(price))) {
        totalValue += Math.round(qty * Number(price))
        hasPrices = true
      }
    }

    const collisions = (byDate.get(snap.date) ?? []).map(s => ({
      sessionId: s.sessionId ?? null,
      source:    s.source === 'import' ? 'import' : 'stocktake',
      itemCount: (s.items ?? []).length,
      importBatchId: s.importBatchId ?? null,
    }))

    return {
      date:       snap.date,
      items,
      itemCount:  items.length,
      totalValue: hasPrices ? totalValue : null,
      collisions,
      // 既定は非破壊。上書きはユーザーが日付ごとに選んだときだけ。
      resolution: ON_CONFLICT_ADD,
    }
  })

  return {
    importBatchId: importBatchId ?? newImportBatchId(),
    days,
    totals: {
      days:       days.length,
      items:      days.reduce((n, d) => n + d.itemCount, 0),
      conflicts:  days.filter(d => d.collisions.length > 0).length,
    },
  }
}

/** 日付ごとの上書き／追加の選択を差し替えた計画を返す（計画は書き換えない） */
export function withResolution(plan, date, resolution) {
  return {
    ...plan,
    days: plan.days.map(d => (d.date === date ? { ...d, resolution } : d)),
  }
}

/** 選択が済んでいない衝突が残っていないか（残っていれば確定させない） */
export function unresolvedConflicts(plan) {
  return plan.days.filter(d => d.collisions.length > 0 && !d.resolution)
}

/**
 * 計画をサーバーへ確定する。**1日ずつ、サーバーの応答を確認してから**端末へ反映する。
 * 途中で失敗しても、そこまでに成功した日ぶんは同じ importBatchId に属するので、
 * まとめて取り消せる。
 *
 * @param {object}   plan
 * @param {object}   io
 * @param {Function} io.saveToServer   (batchId, payload) => Promise<{ ok, sessionId, ... }>
 * @param {Function} io.applyLocal     ({ date, items, sessionId, importBatchId }) => snapshot|null
 * @returns {{ importBatchId, saved: Array, failed: Array, ok: boolean }}
 */
export async function commitPastImport(plan, { saveToServer, applyLocal }) {
  const saved  = []
  const failed = []

  for (const day of plan.days) {
    // 上書きを選んだ日だけ、既存 sessionId を明示して渡す。
    // sessionId を持たない legacy 行はサーバーで消せないため対象にしない。
    const replaceSessionIds = day.resolution === ON_CONFLICT_REPLACE
      ? day.collisions.map(c => c.sessionId).filter(Boolean)
      : []

    let res
    try {
      res = await saveToServer(plan.importBatchId, {
        date:  day.date,
        items: day.items,
        replaceSessionIds,
        snapshot: { date: day.date, source: 'import' },
      })
    } catch (err) {
      failed.push({ date: day.date, error: err?.message ?? '保存に失敗しました', retryable: err?.body?.retryable === true })
      continue
    }

    // サーバーが sessionId を返して初めて「取り込めた」とみなす。
    if (!res?.ok || !res?.sessionId) {
      failed.push({ date: day.date, error: res?.error ?? 'サーバーが保存を確認できませんでした', retryable: false })
      continue
    }

    applyLocal?.({
      date:          day.date,
      items:         day.items,
      sessionId:     res.sessionId,
      importBatchId: plan.importBatchId,
    })
    saved.push({ date: day.date, sessionId: res.sessionId, itemCount: res.itemCount ?? day.itemCount })
  }

  return { importBatchId: plan.importBatchId, saved, failed, ok: failed.length === 0 && saved.length > 0 }
}

/**
 * 取込バッチを取り消す。**サーバーの結果を確認してから**端末を消す。
 * サーバーで消せていないのに端末から消すと、次の同期で復活して「消えない」ように見える。
 *
 * @returns {{ ok, removedOnServer, removedLocally }}
 */
export async function cancelPastImport(importBatchId, { cancelOnServer, deleteLocal }) {
  const res = await cancelOnServer(importBatchId)
  if (!res?.ok) {
    throw new Error(res?.error ?? '取込を取り消せませんでした')
  }
  const removedLocally = deleteLocal?.(importBatchId) ?? 0
  return { ok: true, removedOnServer: res.removed ?? 0, removedLocally }
}
