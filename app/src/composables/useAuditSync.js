import { ref } from 'vue'
import { HTTP_BASE as BASE, apiFetch as _api } from '../utils/api.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { shopCode } from './useStore.js'

/**
 * 操作ログ（変更履歴）を D1 へ送る（migration 0017）。
 *
 * ## なぜ別のキューなのか
 *
 * `useStore` の pendingSaves は「同じ資源の最新が勝つ」キューで、状態の置き換え向け。
 * 操作ログは**追記専用**なので、同じキーで上書きすると記録が落ちる。別に持つ。
 *
 * ## 約束
 *
 * - **記録の保存が棚卸を止めてはならない。** 送信失敗は握りつぶし、キューに残して次で送る。
 * - 1入力ごとに通信しない。まとめて送る（既定 FLUSH_DELAY_MS 後、または上限件数で即時）。
 * - `id` が同じ再送は server 側で無視される（冪等）ので、そのまま送り直してよい。
 * - キューは localStorage に持つので、再読込・アプリ再起動をまたいでも送り直せる。
 */

export const AUDIT_BATCH_LIMIT = 200   // worker の MAX_AUDIT_PER_REQUEST と揃える
const FLUSH_DELAY_MS  = 3000
const MAX_QUEUE       = 5000           // 暴走時の歯止め（古い方から落とす）

// { sessionId, entry } の配列。sessionId ごとに送るのでエントリに持たせる。
let _queue = []
let _timer = null
let _flushing = null

export const auditPendingCount = ref(0)

function _syncCount() { auditPendingCount.value = _queue.length }

function _persist() {
  _syncCount()
  try {
    if (_queue.length === 0) localStorage.removeItem(STORAGE_KEYS.auditQueue)
    else localStorage.setItem(STORAGE_KEYS.auditQueue, JSON.stringify(_queue))
  } catch (_) { /* 容量不足でもメモリ上のキューは生きている */ }
}

export function restoreAuditQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.auditQueue)
    const saved = raw ? JSON.parse(raw) : null
    _queue = Array.isArray(saved) ? saved.filter(r => r?.sessionId && r?.entry?.id) : []
  } catch (_) { _queue = [] }
  _syncCount()
}

/** テスト・アカウント切替用。未送信ぶんは捨てる */
export function clearAuditQueue() {
  _queue = []
  clearTimeout(_timer); _timer = null
  _persist()
}

/**
 * 送信キューへ積む。呼び出し側は失敗を気にしなくてよい。
 * 同じ id が既にキューにあれば積み直さない。
 */
export function queueAuditEntries(sessionId, entries) {
  if (!sessionId) return
  const list = Array.isArray(entries) ? entries : [entries]
  const known = new Set(_queue.map(r => r.entry.id))
  let added = 0
  for (const entry of list) {
    if (!entry?.id || known.has(entry.id)) continue
    known.add(entry.id)
    _queue.push({ sessionId, entry })
    added++
  }
  if (added === 0) return
  if (_queue.length > MAX_QUEUE) _queue.splice(0, _queue.length - MAX_QUEUE)
  _persist()

  // 上限ぶん溜まったら待たずに送る。それ以外は少し待ってまとめる。
  if (_queue.length >= AUDIT_BATCH_LIMIT) { flushAuditQueue(); return }
  clearTimeout(_timer)
  _timer = setTimeout(() => { _timer = null; flushAuditQueue() }, FLUSH_DELAY_MS)
}

/**
 * キューを送る。成功したぶんだけ捨て、失敗は残す（次の flush で送り直す）。
 * 例外は投げない。
 */
export function flushAuditQueue() {
  if (_flushing) return _flushing
  _flushing = _run().finally(() => { _flushing = null })
  return _flushing
}

async function _run() {
  clearTimeout(_timer); _timer = null
  const code = shopCode.value
  // BASE が空（未設定・テスト）や店舗未登録では送れない。キューは残す。
  if (!BASE || !code || _queue.length === 0) return

  // sessionId ごとにまとめる。1要求＝1セッション。
  const bySession = new Map()
  for (const row of _queue) {
    if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, [])
    bySession.get(row.sessionId).push(row.entry)
  }

  for (const [sessionId, entries] of bySession) {
    for (let i = 0; i < entries.length; i += AUDIT_BATCH_LIMIT) {
      const batch = entries.slice(i, i + AUDIT_BATCH_LIMIT)
      try {
        await _api(`/store/${code}/sessions/${sessionId}/audit`, {
          method: 'POST',
          body: JSON.stringify({ entries: batch }),
        })
        const sent = new Set(batch.map(e => e.id))
        _queue = _queue.filter(r => !(r.sessionId === sessionId && sent.has(r.entry.id)))
        _persist()
      } catch (e) {
        // 404（セッションが消えた）・409（別店舗）は送り直しても通らないので捨てる。
        // それ以外（通信断・503・0017 未適用）はキューに残して次で送る。
        const status = e?.status
        if (status === 404 || status === 409 || status === 400) {
          const drop = new Set(batch.map(x => x.id))
          _queue = _queue.filter(r => !(r.sessionId === sessionId && drop.has(r.entry.id)))
          _persist()
        }
        console.warn('[audit] flush failed:', sessionId, e?.message ?? e)
        return   // 続きは次の flush で
      }
    }
  }
}

/**
 * D1 から1セッションの操作ログを読む。**別端末で記録された分をここで取り込む。**
 * 読めなければ空配列（画面は端末に残っているぶんで動く）。
 */
export async function loadAuditFromD1(sessionId) {
  const code = shopCode.value
  if (!BASE || !code || !sessionId) return []
  try {
    const rows = await _api(`/store/${code}/sessions/${sessionId}/audit`)
    return Array.isArray(rows) ? rows : []
  } catch (e) {
    console.warn('[audit] load failed:', sessionId, e?.message ?? e)
    return []
  }
}
