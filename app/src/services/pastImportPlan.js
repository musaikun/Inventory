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

// 失敗の種類。**応答が届かなかった日は「失敗」ではなく「結果不明」**として扱う。
// サーバー側では保存できている可能性があり、端末側から見て区別できないため。
export const OUTCOME_FAILED  = 'failed'   // サーバーが「保存しなかった」と答えた
export const OUTCOME_UNKNOWN = 'unknown'  // 応答が届かなかった（保存済みかもしれない）

/**
 * 計画をサーバーへ確定する。**1日ずつ、サーバーの応答を確認してから**端末へ反映する。
 *
 * 同じ `importBatchId` の再送はサーバー側で冪等（同じ (shop_code, batchId, date) は
 * 同じ session を貼り直す）なので、**再試行しても成功済みの日が重複しない**。
 * そのため再試行は必ず同じ batchId で行い、ここで新しい ID を作らない。
 *
 * @param {object}   plan
 * @param {object}   io
 * @param {Function} io.saveToServer   (batchId, payload) => Promise<{ ok, sessionId, ... }>
 * @param {Function} io.applyLocal     ({ date, items, sessionId, importBatchId }) => snapshot|null
 * @param {string[]} [io.onlyDates]    この日付だけを送る（部分再試行）。未指定なら全日
 * @returns {{ importBatchId, saved: Array, failed: Array, ok: boolean }}
 *   failed[].outcome … OUTCOME_FAILED | OUTCOME_UNKNOWN
 */
export async function commitPastImport(plan, { saveToServer, applyLocal, onlyDates } = {}) {
  const saved  = []
  const failed = []

  const target = Array.isArray(onlyDates) && onlyDates.length
    ? plan.days.filter(d => onlyDates.includes(d.date))
    : plan.days

  for (const day of target) {
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
      // 例外＝応答が届かなかった。サーバーには入っているかもしれないので「結果不明」。
      failed.push({
        date:      day.date,
        error:     err?.message ?? '保存の結果を確認できませんでした',
        outcome:   OUTCOME_UNKNOWN,
        retryable: true,
      })
      continue
    }

    // サーバーが sessionId を返して初めて「取り込めた」とみなす。
    if (!res?.ok || !res?.sessionId) {
      // 明示的な拒否（ok:false + 理由）は失敗。応答の形が想定外なら結果不明として扱う。
      const explicit = res?.ok === false && !!res?.error
      failed.push({
        date:      day.date,
        error:     res?.error ?? 'サーバーが保存を確認できませんでした',
        outcome:   explicit ? OUTCOME_FAILED : OUTCOME_UNKNOWN,
        retryable: true,
      })
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
 * 再試行の結果を前回の結果へ畳み込む。
 *
 * 再試行では**まだ確定していない日だけ**を送るので、成功した日を saved へ移し、
 * 失敗・結果不明のまま残った日だけを failed に残す。saved を作り直さないので、
 * 1回目に成功した日を二重にカウントしない。
 */
export function mergeCommitResults(prev, next) {
  if (!prev) return next
  const retriedDates = new Set([
    ...next.saved.map(s => s.date),
    ...next.failed.map(f => f.date),
  ])
  const saved = [
    ...prev.saved.filter(s => !next.saved.some(n => n.date === s.date)),
    ...next.saved,
  ].sort((a, b) => a.date.localeCompare(b.date))
  const failed = [
    ...prev.failed.filter(f => !retriedDates.has(f.date)),
    ...next.failed,
  ].sort((a, b) => a.date.localeCompare(b.date))

  return {
    importBatchId: prev.importBatchId ?? next.importBatchId,
    saved,
    failed,
    ok: failed.length === 0 && saved.length > 0,
  }
}

/** 再試行の対象日（失敗した日と、結果が分からない日）。成功済みの日は送り直さない。 */
export function retryableDates(result) {
  return (result?.failed ?? []).map(f => f.date).filter(d => d && d !== '—')
}

/**
 * 取消の導線を出すべきか。
 *
 * `saved` が0件でも、応答が届かなかった日があればサーバーには入っている可能性がある。
 * このときに取消を隠すと、ユーザーは「取り込めていない」と思ったまま、実際には
 * 残っているデータを消せない。**結果不明が1つでもあれば取消できるようにする。**
 */
export function canCancelBatch(result) {
  if (!result?.importBatchId) return false
  if ((result.saved ?? []).length > 0) return true
  return (result.failed ?? []).some(f => f.outcome !== OUTCOME_FAILED)
}

/**
 * 取込バッチを取り消す。**サーバーの結果を確認してから**端末を消す。
 * サーバーで消せていないのに端末から消すと、次の同期で復活して「消えない」ように見える。
 *
 * 取消は `import_batch_id` の一致だけを条件にするので冪等で、
 * 「端末には1件も入っていないが、サーバーには入ったかもしれない」状態でも実行できる。
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
