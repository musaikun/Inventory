import { RoomDO } from './RoomDO.js'
import { parsePdfFile } from './pdfParser.js'
import {
  handleStoreCreate, handleStoreGet,
  handleConfigGet,   handleConfigPut,
  handleInventoryGet, handleInventoryPut,
  handleHistoryGet,  handleHistoryPost, handleHistoryDelete,
  handleRoomUpdate,
  handleSessionsGet, handleSessionCreate, handleSessionUpdate, handleSessionDelete,
  handleSessionComplete, handleRoomResult,
  handleOrdersGet, handleOrderCreate, handleOrderDelete,
} from './storeHandler.js'
import { handleRegister, handleLogin, handleLogout, verifyAuth, verifyStoreAccess } from './authHandler.js'
import { clientIp, isIpBlocked, recordIpFail } from './rateLimiter.js'
import { savePushSubscription, deletePushSubscription, handleCron } from './pushHandler.js'
export { RoomDO }

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin':  allowedOrigin || origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
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

    // Origin 検証
    if (allowedOrigin && origin !== allowedOrigin) {
      return new Response('Forbidden', { status: 403 })
    }

    const path = url.pathname

    // ── 全ルートを try/catch で包む（例外時も必ずCORSヘッダーを返す）─────────
    try {

    // ── 認証 API ──────────────────────────────────────────────────────────────
    if (env.DB) {
      if (path === '/auth/register' && request.method === 'POST') {
        return resultResponse(await handleRegister(env.DB, await request.json()), origin, allowedOrigin)
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
        if (/^\/(config|inventory|history|room|orders)(\/|$)/.test(subpath)) {
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
        // DELETE /store/:code/history/:date
        const histDateMatch = subpath.match(/^\/history\/(\d{4}-\d{2}-\d{2})$/)
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
          return jsonResponse(await handleOrderDelete(env.DB, code, orderDelMatch[1]), 200, origin, allowedOrigin)
        }

        // POST /store/:code/push/subscribe
        if (subpath === '/push/subscribe' && request.method === 'POST') {
          await savePushSubscription(env.DB, code, await request.json())
          return jsonResponse({ ok: true }, 200, origin, allowedOrigin)
        }
        // DELETE /store/:code/push/subscribe
        if (subpath === '/push/subscribe' && request.method === 'DELETE') {
          const { endpoint } = await request.json()
          await deletePushSubscription(env.DB, code, endpoint)
          return jsonResponse({ ok: true }, 200, origin, allowedOrigin)
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
      try {
        const buf    = await request.arrayBuffer()
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

      if (env.DB) {
        const ip = clientIp(request)
        if (await isIpBlocked(env.DB, ip, 'probe')) {
          return jsonResponse({ error: 'アクセスが多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
        }
        // フェイルオープン: stores が読めない場合はゲートを素通しして DO に委ねる
        let store = null, gateOk = true
        try {
          store = await env.DB.prepare('SELECT shop_code FROM stores WHERE shop_code = ?').bind(code).first()
        } catch (e) {
          console.error('[Worker] room gate store lookup failed (fail-open):', e?.message ?? e)
          gateOk = false
        }
        if (gateOk && !store) {
          await recordIpFail(env.DB, ip, 'probe')
          return jsonResponse({ error: 'ルームが見つかりません' }, 404, origin, allowedOrigin)
        }
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
