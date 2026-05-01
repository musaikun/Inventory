import { RoomDO } from './RoomDO.js'
import { parsePdfFile } from './pdfParser.js'
export { RoomDO }

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin':  allowedOrigin || origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function jsonResponse(body, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowedOrigin) },
  })
}

/**
 * メインエントリ
 * ルート:
 *   /room/{CODE}/ws  → Durable Object（WebSocket）
 *   /pdf             → PDF テキスト抽出（POST）
 *   /health          → ヘルスチェック
 */
export default {
  async fetch(request, env) {
    const url    = new URL(request.url)
    const origin = request.headers.get('Origin') || ''

    const allowedOrigin = env.ALLOWED_ORIGIN || ''

    // CORS プリフライト（/pdf エンドポイント用）
    if (url.pathname === '/pdf' && request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders(origin, allowedOrigin), 'Access-Control-Max-Age': '86400' },
      })
    }

    // Origin 検証（ALLOWED_ORIGIN が設定されている場合のみ強制）
    if (allowedOrigin) {
      if (origin !== allowedOrigin) {
        return new Response('Forbidden', { status: 403 })
      }
    }

    // PDF テキスト抽出エンドポイント
    if (url.pathname === '/pdf' && request.method === 'POST') {
      try {
        const buf    = await request.arrayBuffer()
        const result = await parsePdfFile(buf)
        return jsonResponse(result, 200, origin, allowedOrigin)
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, origin, allowedOrigin)
      }
    }

    // WebSocket エンドポイント
    const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,6})\/ws$/i)
    if (match) {
      const code = match[1].toUpperCase()
      const id   = env.ROOMS.idFromName(`room:${code}`)
      const room = env.ROOMS.get(id)
      return room.fetch(request)
    }

    // ヘルスチェック
    if (url.pathname === '/health') {
      return new Response('OK', { headers: { 'Content-Type': 'text/plain' } })
    }

    return new Response('Not found', { status: 404 })
  },
}
