import { RoomDO } from './RoomDO.js'
import { parsePdfFile } from './pdfParser.js'
import {
  handleStoreCreate, handleStoreGet,
  handleConfigGet,   handleConfigPut,
  handleInventoryGet, handleInventoryPut,
  handleHistoryGet,  handleHistoryPost, handleHistoryDelete,
  handleRoomUpdate,
  handleSessionsGet, handleSessionCreate, handleSessionUpdate, handleSessionDelete,
} from './storeHandler.js'
import { handleRegister, handleLogin, handleLogout, verifyAuth } from './authHandler.js'
export { RoomDO }

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin':  allowedOrigin || origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    // Authorization ヘッダーを追加（認証付きAPIで必要）
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function jsonResponse(body, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowedOrigin) },
  })
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
        const result = await handleRegister(env.DB, await request.json())
        const status = result._status ?? 200; delete result._status
        return jsonResponse(result, status, origin, allowedOrigin)
      }
      if (path === '/auth/login' && request.method === 'POST') {
        const result = await handleLogin(env.DB, await request.json())
        const status = result._status ?? 200; delete result._status
        return jsonResponse(result, status, origin, allowedOrigin)
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
          return jsonResponse(await handleConfigPut(env.DB, code, await request.json()), 200, origin, allowedOrigin)
        }
        // GET/PUT /store/:code/inventory
        if (subpath === '/inventory' && request.method === 'GET') {
          return jsonResponse(await handleInventoryGet(env.DB, code) ?? {}, 200, origin, allowedOrigin)
        }
        if (subpath === '/inventory' && request.method === 'PUT') {
          return jsonResponse(await handleInventoryPut(env.DB, code, await request.json()), 200, origin, allowedOrigin)
        }
        // GET/POST /store/:code/history
        if (subpath === '/history' && request.method === 'GET') {
          return jsonResponse(await handleHistoryGet(env.DB, code), 200, origin, allowedOrigin)
        }
        if (subpath === '/history' && request.method === 'POST') {
          return jsonResponse(await handleHistoryPost(env.DB, code, await request.json()), 200, origin, allowedOrigin)
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

        // GET/POST /store/:code/sessions （要認証）
        if (subpath === '/sessions' && request.method === 'GET') {
          const authCode = await verifyAuth(env.DB, request)
          if (authCode !== code) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
          return jsonResponse(await handleSessionsGet(env.DB, code), 200, origin, allowedOrigin)
        }
        if (subpath === '/sessions' && request.method === 'POST') {
          const authCode = await verifyAuth(env.DB, request)
          if (authCode !== code) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
          return jsonResponse(await handleSessionCreate(env.DB, code), 200, origin, allowedOrigin)
        }

        // PUT /store/:code/sessions/:id （要認証）
        const sessMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})$/)
        if (sessMatch && request.method === 'PUT') {
          const authCode = await verifyAuth(env.DB, request)
          if (authCode !== code) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
          const result = await handleSessionUpdate(env.DB, code, sessMatch[1], await request.json())
          const status = result._status ?? 200; delete result._status
          return jsonResponse(result, status, origin, allowedOrigin)
        }
        if (sessMatch && request.method === 'DELETE') {
          const authCode = await verifyAuth(env.DB, request)
          if (authCode !== code) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
          return jsonResponse(await handleSessionDelete(env.DB, code, sessMatch[1]), 200, origin, allowedOrigin)
        }
      }
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

    // ── ルーム解散（退室済み残存ルームの掃除・HTTP）──────────────────────────
    const dissolveMatch = path.match(/^\/room\/([A-Z0-9]{4,8})\/dissolve$/i)
    if (dissolveMatch && request.method === 'POST') {
      const code = dissolveMatch[1].toUpperCase()
      const id   = env.ROOMS.idFromName(`room:${code}`)
      const room = env.ROOMS.get(id)
      const res  = await room.fetch(request)
      const body = await res.json().catch(() => ({}))
      return jsonResponse(body, res.status, origin, allowedOrigin)
    }

    // ── ルーム状態取得（退室中ホストのライブ品目数表示・HTTP）────────────────
    const statusMatch = path.match(/^\/room\/([A-Z0-9]{4,8})\/status$/i)
    if (statusMatch && request.method === 'GET') {
      const code = statusMatch[1].toUpperCase()
      const id   = env.ROOMS.idFromName(`room:${code}`)
      const room = env.ROOMS.get(id)
      const res  = await room.fetch(request)
      const body = await res.json().catch(() => ({}))
      return jsonResponse(body, res.status, origin, allowedOrigin)
    }

    // ── WebSocket（リアルタイム同期）─────────────────────────────────────────
    const wsMatch = path.match(/^\/room\/([A-Z0-9]{4,8})\/ws$/i)
    if (wsMatch) {
      const code = wsMatch[1].toUpperCase()
      const id   = env.ROOMS.idFromName(`room:${code}`)
      const room = env.ROOMS.get(id)
      return room.fetch(request)
    }

    // ── ヘルスチェック ────────────────────────────────────────────────────────
    if (path === '/health') {
      return new Response('OK', { headers: { 'Content-Type': 'text/plain' } })
    }

    return jsonResponse({ error: 'Not found' }, 404, origin, allowedOrigin)

    } catch (e) {
      // 未処理の例外でも必ずCORSヘッダー付きでエラーを返す
      console.error('[Worker] Unhandled error:', e?.message ?? e)
      return jsonResponse({ error: e?.message ?? 'Internal server error' }, 500, origin, allowedOrigin)
    }
  },
}
