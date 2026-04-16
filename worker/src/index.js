import { RoomDO } from './RoomDO.js'
export { RoomDO }

/**
 * メインエントリ
 * ルート: /room/{CODE}/ws  → Durable Object（WebSocket）
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Origin 検証（ALLOWED_ORIGIN が設定されている場合のみ強制）
    const allowedOrigin = env.ALLOWED_ORIGIN || ''
    if (allowedOrigin) {
      const origin = request.headers.get('Origin') || ''
      if (origin !== allowedOrigin) {
        return new Response('Forbidden', { status: 403 })
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
      return new Response('OK', {
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
