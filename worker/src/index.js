import { RoomDO } from './RoomDO.js'
import { parsePdfFile } from './pdfParser.js'
import {
  handleStoreCreate, handleStoreGet,
  handleConfigGet,   handleConfigPut,
  handleInventoryGet, handleInventoryPut,
  handleHistoryGet,  handleHistoryPost, handleHistoryDelete,
  handleRoomUpdate,
  handleSessionsGet, handleSessionCreate, handleSessionUpdate, handleSessionDelete,
  handleSessionComplete, handleSessionLinesGet, handleRoomResult,
  handleOrdersGet, handleOrderCreate, handleOrderDelete,
  handleMovementsGet, handleMovementCreate, handleMovementDelete,
} from './storeHandler.js'
import { handlePastImportCreate, handlePastImportCancel } from './pastImport.js'
import { handleRegister, handleLogin, handleLogout, verifyAuth, verifyStoreAccess } from './authHandler.js'
import { handleAccountDelete } from './accountDeletion.js'
import { clientIp, isIpBlocked, recordIpFail } from './rateLimiter.js'
import { savePushSubscription, deletePushSubscription, handleCron } from './pushHandler.js'
import {
  ACCOUNT_DELETION_INTERNAL_HEADER,
  MAX_PDF_BYTES,
  MAX_PUSH_SUBSCRIPTION_BYTES,
} from './constants.js'
export { RoomDO }

// 許可オリジン判定（フェイルクローズ・S-E）。ALLOWED_ORIGIN（カンマ区切りの完全一致）に加え、
// 本番/プレビュー（*.inventory-app.pages.dev＝プロジェクト所有者のみが配信可能）と
// ローカル開発（localhost / 127.0.0.1）を許可する。それ以外の Origin は拒否。
// Origin ヘッダ無し（同一オリジン・WebSocket・server-to-server）は従来どおり通す。
export function isAllowedOrigin(origin, allowedOrigin) {
  if (!origin) return true
  const list = String(allowedOrigin || '').split(',').map(s => s.trim()).filter(Boolean)
  if (list.includes(origin)) return true
  try {
    const h = new URL(origin).hostname
    if (h === 'inventory-app.pages.dev' || h.endsWith('.inventory-app.pages.dev')) return true
    if (h === 'localhost' || h === '127.0.0.1') return true
  } catch (_) { /* 不正な Origin は不許可 */ }
  return false
}

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
  // 許可した Origin のみを個別に反映（ワイルドカード '*' は使わない＝フェイルクローズ）。
  if (origin && isAllowedOrigin(origin, allowedOrigin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function jsonResponse(body, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowedOrigin) },
  })
}

// ハンドラ戻り値の { _status } をHTTPステータスへ変換して返す（本文からは除去）
function resultResponse(result, origin, allowedOrigin) {
  const status = result._status ?? 200
  delete result._status
  return jsonResponse(result, status, origin, allowedOrigin)
}

async function _requireAuth(db, request, code, origin, allowedOrigin) {
  const authCode = await verifyAuth(db, request)
  if (authCode !== code) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
  return null
}

async function _readJsonBodyWithLimit(request, maxBytes) {
  const tooLarge = {
    _status: 413,
    code: 'payload_too_large',
    error: 'リクエストデータが大きすぎます',
  }
  const declared = Number(request.headers.get('Content-Length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { error: tooLarge }

  // Unit-test request doubles do not always expose a ReadableStream.
  if (!request.body || typeof request.body.getReader !== 'function') {
    try {
      const body = await request.json()
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > maxBytes) return { error: tooLarge }
      return { body }
    } catch (_) {
      return { error: { _status: 400, code: 'invalid_json', error: 'JSONが不正です' } }
    }
  }

  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      total += chunk.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { error: tooLarge }
      }
      chunks.push(chunk)
    }
  } catch (_) {
    return { error: { _status: 400, code: 'invalid_json', error: 'JSONが不正です' } }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch (_) {
    return { error: { _status: 400, code: 'invalid_json', error: 'JSONが不正です' } }
  }
}

export async function purgeAccountRooms(rooms, shopCode) {
  const results = await Promise.allSettled(['', ':order'].map(async suffix => {
    const id = rooms.idFromName(`room:${shopCode}${suffix}`)
    const room = rooms.get(id)
    const response = await room.fetch(new Request('https://internal/internal/account-delete', {
      method: 'DELETE',
      headers: { 'X-Inventory-Internal-Action': ACCOUNT_DELETION_INTERNAL_HEADER },
    }))
    if (!response.ok) throw new Error(`Durable Object purge failed (${response.status})`)
  }))
  const failed = results.find(result => result.status === 'rejected')
  if (failed) throw new Error('Durable Object purge failed', { cause: failed.reason })
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url)
    const origin = request.headers.get('Origin') || ''
    const allowedOrigin = env.ALLOWED_ORIGIN || ''

    // CORS プリフライト
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders(origin, allowedOrigin), 'Access-Control-Max-Age': '86400' },
      })
    }

    // Origin 検証（フェイルクローズ・S-E）: Origin が有り、かつ許可リスト外なら拒否。
    // ALLOWED_ORIGIN 未設定でも既定の許可（本番/プレビュー/ローカル）以外は通さない。
    if (origin && !isAllowedOrigin(origin, allowedOrigin)) {
      return new Response('Forbidden', { status: 403 })
    }

    const path = url.pathname

    // ── 全ルートを try/catch で包む（例外時も必ずCORSヘッダーを返す）─────────
    try {

    // ── 認証 API ──────────────────────────────────────────────────────────────
    if (env.DB) {
      if (path === '/auth/register' && request.method === 'POST') {
        return resultResponse(await handleRegister(
          env.DB,
          await request.json(),
          { defaultPlan: env.DEFAULT_STORE_PLAN },
        ), origin, allowedOrigin)
      }
      if (path === '/auth/login' && request.method === 'POST') {
        // IP単位の横断制限（店舗コードを変えながらの総当たりを塞ぐ。店舗単位制限は handleLogin 内）
        const ip = clientIp(request)
        if (await isIpBlocked(env.DB, ip, 'login')) {
          return jsonResponse({ error: 'ログイン試行が多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
        }
        const result = await handleLogin(env.DB, await request.json())
        if (result._status === 401) await recordIpFail(env.DB, ip, 'login')
        return resultResponse(result, origin, allowedOrigin)
      }
      if (path === '/auth/logout' && request.method === 'POST') {
        return jsonResponse(await handleLogout(env.DB, request), 200, origin, allowedOrigin)
      }
      if (path === '/auth/account' && request.method === 'DELETE') {
        const body = await request.json().catch(() => ({}))
        const result = await handleAccountDelete(
          env.DB,
          request,
          body,
          shopCode => purgeAccountRooms(env.ROOMS, shopCode),
        )
        return resultResponse(result, origin, allowedOrigin)
      }
    }

    // ── 店舗 API ──────────────────────────────────────────────────────────────
    if (!env.DB) {
      // D1 未設定の場合はスキップ（既存機能に影響しない）
    } else {
      // POST /store/create
      if (path === '/store/create' && request.method === 'POST') {
        const result = await handleStoreCreate(env.DB)
        return jsonResponse(result, 200, origin, allowedOrigin)
      }

      // /store/:code/*
      const storeMatch = path.match(/^\/store\/([A-Z]{4,8})(\/.*)?$/i)
      if (storeMatch) {
        const code    = storeMatch[1].toUpperCase()
        const subpath = storeMatch[2] ?? ''

        // データ系API（config/inventory/history/room）は後方互換ソフト認証で保護。
        // PIN設定済み店舗はトークン必須、レガシー店舗は従来通り許可。
        if (/^\/(config|inventory|history|room|orders|movements)(\/|$)/.test(subpath)) {
          if (!(await verifyStoreAccess(env.DB, code, request))) {
            return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
          }
        }

        // GET /store/:code
        if (subpath === '' && request.method === 'GET') {
          const store = await handleStoreGet(env.DB, code)
          if (!store) return jsonResponse({ error: '店舗が見つかりません' }, 404, origin, allowedOrigin)
          return jsonResponse(store, 200, origin, allowedOrigin)
        }
        // GET/PUT /store/:code/config
        if (subpath === '/config' && request.method === 'GET') {
          return jsonResponse(await handleConfigGet(env.DB, code) ?? {}, 200, origin, allowedOrigin)
        }
        if (subpath === '/config' && request.method === 'PUT') {
          return resultResponse(await handleConfigPut(env.DB, code, await request.json()), origin, allowedOrigin)
        }
        // GET/PUT /store/:code/inventory
        if (subpath === '/inventory' && request.method === 'GET') {
          return jsonResponse(await handleInventoryGet(env.DB, code) ?? {}, 200, origin, allowedOrigin)
        }
        if (subpath === '/inventory' && request.method === 'PUT') {
          return resultResponse(await handleInventoryPut(env.DB, code, await request.json()), origin, allowedOrigin)
        }
        // GET/POST /store/:code/history
        if (subpath === '/history' && request.method === 'GET') {
          return jsonResponse(await handleHistoryGet(env.DB, code), 200, origin, allowedOrigin)
        }
        if (subpath === '/history' && request.method === 'POST') {
          return resultResponse(await handleHistoryPost(env.DB, code, await request.json()), origin, allowedOrigin)
        }
        // DELETE /store/:code/history/:key （key = sessionId または legacy日付）
        const histDateMatch = subpath.match(/^\/history\/([\w-]{1,64})$/)
        if (histDateMatch && request.method === 'DELETE') {
          return jsonResponse(await handleHistoryDelete(env.DB, code, histDateMatch[1]), 200, origin, allowedOrigin)
        }
        // PUT /store/:code/room
        if (subpath === '/room' && request.method === 'PUT') {
          return jsonResponse(await handleRoomUpdate(env.DB, code, await request.json()), 200, origin, allowedOrigin)
        }

        // GET/POST /store/:code/orders
        if (subpath === '/orders' && request.method === 'GET') {
          return jsonResponse(await handleOrdersGet(env.DB, code, url.searchParams.get('sinceDays')), 200, origin, allowedOrigin)
        }
        if (subpath === '/orders' && request.method === 'POST') {
          return resultResponse(await handleOrderCreate(env.DB, code, await request.json()), origin, allowedOrigin)
        }
        // DELETE /store/:code/orders/:id
        const orderDelMatch = subpath.match(/^\/orders\/([\w-]{1,64})$/)
        if (orderDelMatch && request.method === 'DELETE') {
          return resultResponse(await handleOrderDelete(env.DB, code, orderDelMatch[1]), origin, allowedOrigin)
        }

        // GET/POST /store/:code/movements
        if (subpath === '/movements' && request.method === 'GET') {
          return jsonResponse(await handleMovementsGet(env.DB, code, url.searchParams.get('sinceDays')), 200, origin, allowedOrigin)
        }
        if (subpath === '/movements' && request.method === 'POST') {
          return resultResponse(await handleMovementCreate(env.DB, code, await request.json()), origin, allowedOrigin)
        }
        // DELETE /store/:code/movements/:id
        const moveDelMatch = subpath.match(/^\/movements\/([\w-]{1,64})$/)
        if (moveDelMatch && request.method === 'DELETE') {
          return jsonResponse(await handleMovementDelete(env.DB, code, moveDelMatch[1]), 200, origin, allowedOrigin)
        }

        // POST/DELETE /store/:code/push/subscribe（strict auth + bounded payload）
        if (subpath === '/push/subscribe' && (request.method === 'POST' || request.method === 'DELETE')) {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const parsed = await _readJsonBodyWithLimit(request, MAX_PUSH_SUBSCRIPTION_BYTES)
          if (parsed.error) return resultResponse(parsed.error, origin, allowedOrigin)
          const result = request.method === 'POST'
            ? await savePushSubscription(env.DB, code, parsed.body)
            : await deletePushSubscription(env.DB, code, parsed.body?.endpoint)
          return resultResponse(result, origin, allowedOrigin)
        }

        // GET/POST /store/:code/sessions （要認証）
        if (subpath === '/sessions' && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return jsonResponse(await handleSessionsGet(env.DB, code), 200, origin, allowedOrigin)
        }
        if (subpath === '/sessions' && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const body = await request.json().catch(() => ({}))
          return jsonResponse(await handleSessionCreate(env.DB, code, body), 200, origin, allowedOrigin)
        }

        // PUT/DELETE /store/:code/sessions/:id （要認証）
        const sessMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})$/)
        if (sessMatch && request.method === 'PUT') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleSessionUpdate(env.DB, code, sessMatch[1], await request.json()), origin, allowedOrigin)
        }
        if (sessMatch && request.method === 'DELETE') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return jsonResponse(await handleSessionDelete(env.DB, code, sessMatch[1]), 200, origin, allowedOrigin)
        }

        // GET /store/:code/sessions/:id/lines （要認証）
        // 端末に snapshot が無くても完了済み棚卸の詳細を開けるようにする（DATA-002 Phase 1）。
        // 単価・在庫金額を含むためゲストには出さない。ここは店舗トークン必須の側に置く。
        const sessLinesMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})\/lines$/)
        if (sessLinesMatch && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleSessionLinesGet(env.DB, code, sessLinesMatch[1]), origin, allowedOrigin)
        }

        // ── 過去棚卸の取込（IMPORT-001）─────────────────────────────────────
        // 単価・在庫を書き換えるので、後方互換ソフト認証ではなく店舗トークン必須の側に置く。
        // 対象は必ず shop_code の内側（handler が全 SQL に shop_code を入れている）。
        //
        // POST /store/:code/imports/:batchId/sessions … 1日ぶんを原子的・冪等に取り込む
        const importCreateMatch = subpath.match(/^\/imports\/([\w-]{1,64})\/sessions$/)
        if (importCreateMatch && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const body = await request.json().catch(() => null)
          if (body == null) {
            return jsonResponse({ error: 'リクエストの形式が不正です' }, 400, origin, allowedOrigin)
          }
          return resultResponse(
            await handlePastImportCreate(env.DB, code, importCreateMatch[1], body),
            origin, allowedOrigin,
          )
        }
        // DELETE /store/:code/imports/:batchId … バッチ単位の取消（冪等）
        const importCancelMatch = subpath.match(/^\/imports\/([\w-]{1,64})$/)
        if (importCancelMatch && request.method === 'DELETE') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(
            await handlePastImportCancel(env.DB, code, importCancelMatch[1]),
            origin, allowedOrigin,
          )
        }

        // POST /store/:code/sessions/:id/complete （要認証）
        const sessCompleteMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})\/complete$/)
        if (sessCompleteMatch && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleSessionComplete(env.DB, code, sessCompleteMatch[1], await request.json()), origin, allowedOrigin)
        }
      }
    }

    // ── プッシュ通知 ───────────────────────────────────────────────────────────
    if (path === '/api/push/vapid-key' && request.method === 'GET') {
      return jsonResponse({ key: env.VAPID_PUBLIC_KEY || null }, 200, origin, allowedOrigin)
    }

    // ── PDF テキスト抽出 ──────────────────────────────────────────────────────
    if (path === '/pdf' && request.method === 'POST') {
      // S-D: 経済的DoS対策。①IPレート制限 → ②認証必須 → ③サイズ上限 の順で
      // 重い pdfjs 実行の前に安価なゲートで弾く。
      const ip = clientIp(request)
      if (await isIpBlocked(env.DB, ip, 'pdf')) {
        return jsonResponse({ error: 'アクセスが多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
      }
      // このエンドポイントは重い処理なので、成否に関わらず1回として計上（総回数を抑制）
      await recordIpFail(env.DB, ip, 'pdf')

      const authCode = await verifyAuth(env.DB, request)
      if (!authCode) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)

      const declared = Number(request.headers.get('Content-Length') ?? '')
      if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
        return jsonResponse({ error: 'ファイルサイズが大きすぎます（上限5MB）' }, 413, origin, allowedOrigin)
      }
      try {
        const buf = await request.arrayBuffer()
        if (buf.byteLength > MAX_PDF_BYTES) {
          return jsonResponse({ error: 'ファイルサイズが大きすぎます（上限5MB）' }, 413, origin, allowedOrigin)
        }
        const result = await parsePdfFile(buf)
        return jsonResponse(result, 200, origin, allowedOrigin)
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, origin, allowedOrigin)
      }
    }

    // ── 完了後ゲスト閲覧（無認証・URLが鍵）────────────────────────────────────
    // GET /room/:code/result?s=<sessionId> — D1 スナップショットから金額抜きの結果を返す
    const resultMatch = path.match(/^\/room\/([A-Z0-9]{4,8})\/result$/i)
    if (resultMatch && request.method === 'GET') {
      const code = resultMatch[1].toUpperCase()
      const sid  = url.searchParams.get('s') ?? ''
      if (!env.DB) return jsonResponse({ error: 'サービスを利用できません' }, 503, origin, allowedOrigin)
      const ip = clientIp(request)
      if (await isIpBlocked(env.DB, ip, 'probe')) {
        return jsonResponse({ error: 'アクセスが多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
      }
      const activeStore = await env.DB.prepare(
        'SELECT shop_code FROM stores WHERE shop_code = ? AND deleted_at IS NULL AND deletion_pending_at IS NULL'
      ).bind(code).first()
      if (!activeStore) {
        await recordIpFail(env.DB, ip, 'probe')
        return jsonResponse({ error: 'この棚卸は閲覧できません' }, 404, origin, allowedOrigin)
      }
      const result = await handleRoomResult(env.DB, code, sid)
      // 「見つからない・無効」は総当たり探索とみなして記録（期間切れ 410 は除外）
      if (result._status === 400 || result._status === 404) await recordIpFail(env.DB, ip, 'probe')
      return resultResponse(result, origin, allowedOrigin)
    }

    // ── ルーム API（ルームID = 店舗コード）────────────────────────────────────
    // 存在しない店舗コードは Worker 層で 404 にして DO を起動させない。
    // 失敗を IP 単位で記録し、上限超過でブロック（ルームコード総当たり対策）
    const roomMatch = path.match(/^\/room\/([A-Z0-9]{4,8})\/(dissolve|status|ws)$/i)
    if (roomMatch) {
      const code   = roomMatch[1].toUpperCase()
      const action = roomMatch[2].toLowerCase()

      // 店舗存在確認はルーム認可境界の一部。DB未設定・D1障害を「存在するかもしれない」と
      // 解釈してDOへ通すと、DO側でも保護状態を確認できず新規ホスト発行へ倒れ得るため閉じる。
      if (!env.DB) {
        return jsonResponse({ code: 'service_unavailable', error: 'サービスを一時的に利用できません' }, 503, origin, allowedOrigin)
      }

      const ip = clientIp(request)
      // レート制限の読取失敗は本体を止めないが、直後の店舗認可は必ず成功を要求する。
      if (await isIpBlocked(env.DB, ip, 'probe')) {
        return jsonResponse({ error: 'アクセスが多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
      }
      let store
      try {
        store = await env.DB.prepare(
          'SELECT shop_code FROM stores WHERE shop_code = ? AND deleted_at IS NULL AND deletion_pending_at IS NULL'
        ).bind(code).first()
      } catch (e) {
        console.error('[Worker] room gate store lookup failed (fail-closed):', e?.message ?? e)
        return jsonResponse({ code: 'service_unavailable', error: 'サービスを一時的に利用できません' }, 503, origin, allowedOrigin)
      }
      if (!store) {
        await recordIpFail(env.DB, ip, 'probe')
        return jsonResponse({ error: 'ルームが見つかりません' }, 404, origin, allowedOrigin)
      }

      // 種類でルーム（DOインスタンス）を分ける。棚卸=既定、発注=:order。
      // ユーザーが見るコードは shopCode のままで、?type=order でDO名だけ切り替える。
      const rtype  = url.searchParams.get('type') === 'order' ? ':order' : ''
      const id   = env.ROOMS.idFromName(`room:${code}${rtype}`)
      const room = env.ROOMS.get(id)
      if (action === 'ws') return room.fetch(request)
      if ((action === 'dissolve' && request.method === 'POST') ||
          (action === 'status'   && request.method === 'GET')) {
        const res  = await room.fetch(request)
        const body = await res.json().catch(() => ({}))
        return jsonResponse(body, res.status, origin, allowedOrigin)
      }
    }

    // ── ヘルスチェック ────────────────────────────────────────────────────────
    if (path === '/health') {
      return new Response('OK', { headers: { 'Content-Type': 'text/plain' } })
    }

    return jsonResponse({ error: 'Not found' }, 404, origin, allowedOrigin)

    } catch (e) {
      // 未処理の例外でも必ずCORSヘッダー付きでエラーを返す
      console.error('[Worker] Unhandled error:', request.method, path, e?.message ?? e)
      return jsonResponse({ error: e?.message ?? 'Internal server error' }, 500, origin, allowedOrigin)
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env))
  },
}
