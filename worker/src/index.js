import { RoomDO } from './RoomDO.js'
import {
  handleStoreGet,
  handleConfigGet,   handleConfigPut,
  handleInventoryGet, handleInventoryPut,
  handleHistoryGet,  handleHistoryGetOne, handleHistoryPost, handleHistoryDelete,
  handleRoomUpdate,
  handleSessionsGet, handleSessionCreate, handleSessionUpdate, handleSessionDelete,
  handleDiscardedList, handlePurgeUnfinished, handleTasksGet, handleTaskUpsert, handleTaskMark, handleSessionRestore,
  handleSessionComplete, handleSessionLinesGet, handleRoomResult,
  handleAuditAppend, handleAuditGet, setDebugErrors,
  handleOrdersGet, handleOrderCreate, handleOrderDelete,
  handleMovementsGet, handleMovementCreate, handleMovementDelete,
} from './storeHandler.js'
import { handlePastImportCreate, handlePastImportCancel } from './pastImport.js'
import { handleRegister, handleLogin, handleLogout, verifyAuth, verifyStoreAccess } from './authHandler.js'
import { handleAccountDelete } from './accountDeletion.js'
import { handleImageUpload, handleImageDelete, handleImageGet, purgeShopImages } from './imageHandler.js'
import { clientIp, isIpBlocked, recordIpFail } from './rateLimiter.js'
import { securityEvent } from './securityLog.js'
import { savePushSubscription, deletePushSubscription, savePushPrefs, sendTestPush, handleCron, notifyTaskAdded, notifyTaskAssigned, notifyStaffJoin } from './pushHandler.js'
import { authContext, ctxCan } from './staffHandler.js'
import { PERMS } from './permissions.js'
import { handlePresenceBeat, handlePresenceGet } from './presenceHandler.js'
import { configChangePerms } from './configGuard.js'
import { stripConfigMoney, restoreConfigMoney, stripSnapshotMoney, stripLinesMoney, restoreSnapshotMoney } from './moneyGuard.js'
import { handleStaffList, handleStaffInvite, handleStaffInviteRevoke, handleStaffAction, handleInviteInfo, handleStaffJoin, handleStaffPending, handleStaffLogin, handleStaffUnlock, handleMe } from './staffHandler.js'
import {
  ACCOUNT_DELETION_INTERNAL_HEADER,
  MAX_PUSH_SUBSCRIPTION_BYTES,
} from './constants.js'
export { RoomDO }

// 配信元の Pages project の host。**この project へ deploy できるのは所有者だけ**なので、
// サブドメイン（preview）ごと許可する。Pages の preview URL は
//   - 固定alias        : `develop.<project>.pages.dev`
//   - deployment hash  : `568e490f.<project>.pages.dev`  ← 毎回変わる
// の2種類があり、hash 側は事前に列挙できない。だからここは host 単位で持つ。
//
// **`inventory-app` と `inventory-app-c40` は別物**。実際に配信されているのは `-c40` 付き。
// 2026-08-28、任意Originを反射する旧Workerから現行Workerへ入れ替えた直後、
// `-c40` が入っていなかったせいでフロントが全滅した（`Failed to fetch` = preflight が
// 403 で Access-Control-Allow-Origin を返さない）。旧Workerが緩く、名前も似ていたため、
// 入れ替えるまで食い違いが表面化しなかった。→ 回帰testは test/corsOrigins.test.js
const PAGES_HOSTS = ['inventory-app-c40.pages.dev', 'inventory-app.pages.dev']

// 許可オリジン判定（フェイルクローズ・S-E）。ALLOWED_ORIGIN（カンマ区切りの完全一致）に加え、
// 上記 Pages project とそのサブドメイン、ローカル開発（localhost / 127.0.0.1）を許可する。
// それ以外の Origin は拒否。
// Origin ヘッダ無し（同一オリジン・WebSocket・server-to-server）は従来どおり通す。
export function isAllowedOrigin(origin, allowedOrigin) {
  if (!origin) return true
  const list = String(allowedOrigin || '').split(',').map(s => s.trim()).filter(Boolean)
  if (list.includes(origin)) return true
  try {
    const { hostname: h, protocol } = new URL(origin)
    // Pages は https のみで配信される。http を許すと、同じ host名の平文Originまで通る。
    if (protocol === 'https:' && PAGES_HOSTS.some(p => h === p || h.endsWith(`.${p}`))) return true
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

/**
 * 役割の権限を確かめる（段 2-3）。オーナー・管理者は全部できる。スタッフは役割＋足し引き。
 * PIN の無い古い店舗（トークン無しで使える）は、これまで通りオーナーと同じに扱う。
 */
async function _requirePerm(db, request, code, perms, origin, allowedOrigin) {
  const ctx = await authContext(db, request)
  if (!ctx) {
    const store = await db.prepare('SELECT pin_hash FROM stores WHERE shop_code = ?').bind(code).first()
    if (store && !store.pin_hash) return null
    return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
  }
  if (ctx.shopCode !== code) return jsonResponse({ error: '認証が必要です' }, 401, origin, allowedOrigin)
  const missing = (Array.isArray(perms) ? perms : [perms]).filter(p => !ctxCan(ctx, p))
  if (!missing.length) return null
  securityEvent('perm_denied', { shop: code, role: ctx.role, missing, path: new URL(request.url).pathname, method: request.method })
  return jsonResponse({
    code: 'forbidden', missing,
    error: `この操作（${missing.map(p => PERMS[p] ?? p).join('・')}）はできません。管理者に許可してもらってください`,
  }, 403, origin, allowedOrigin)
}
/**
 * 記録に刻む「誰が」（段 2-2）。スタッフはトークンの本人（画面から偽れない）、
 * オーナーと暗証番号なしの古い店は、画面が送る端末名・端末 ID のまま。
 */
async function _actor(db, request, code, body) {
  const ctx = await authContext(db, request)
  if (ctx?.staffId && ctx.shopCode === code) return { name: ctx.name, id: ctx.staffId, staff: true }
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  return { name: str(body?.by, 40), id: str(body?.byId, 64), staff: false }
}
/**
 * 金額（単価・小計・在庫金額）を見られるか（段 2-3 の money）。オーナー・管理者・社員は見られる。
 * PIN の無い古い店舗（トークン無しで使える）は、これまで通りオーナーと同じに扱う。
 * 呼ぶのは店舗の認証を通った後。それでもトークンが読めない・店が違うときは見せない側に倒す。
 */
async function _canSeeMoney(db, request, code) {
  const ctx = await authContext(db, request)
  if (!ctx) {
    const store = await db.prepare('SELECT pin_hash FROM stores WHERE shop_code = ?').bind(code).first()
    return !!store && !store.pin_hash
  }
  return ctx.shopCode === code && ctxCan(ctx, 'money')
}
async function _sessionType(db, code, id) {
  const row = await db.prepare('SELECT type FROM sessions WHERE id = ? AND shop_code = ?').bind(id, code).first()
  return row?.type === 'order' ? 'order' : 'stock'
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
  async fetch(request, env, ctx) {
    // 検証環境だけ、失敗応答へ原因の要約を載せる（本番は DEBUG_ERRORS を設定しない）
    setDebugErrors(env.DEBUG_ERRORS === '1')

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

    // ── 品目の画像（読み出し）── 認証なし。id が推測できない乱数であることで守る（imageHandler.js）
    const imgMatch = path.match(/^\/img\/([A-Z]{4,8})\/([0-9a-f]{32})\/([tf])$/)
    if (imgMatch && request.method === 'GET') {
      return await handleImageGet(env.IMAGES, imgMatch[1], imgMatch[2], imgMatch[3])
    }

    // ── 認証 API ──────────────────────────────────────────────────────────────
    if (env.DB) {
      if (path === '/auth/register' && request.method === 'POST') {
        // 店舗の量産を止める（SEC-005）。成否に関わらず IP ごとに数える（1時間に5回まで）
        const ip = clientIp(request)
        if (await isIpBlocked(env.DB, ip, 'register')) {
          return jsonResponse({ code: 'rate_limited', error: '登録の回数が多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
        }
        await recordIpFail(env.DB, ip, 'register')
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
        const body = await request.json()
        const result = await handleLogin(env.DB, body)
        if (result._status === 401) await recordIpFail(env.DB, ip, 'login')
        if (result._status === 401 || result._status === 429) {
          securityEvent(result._status === 429 ? 'login_locked' : 'login_failed', { ip, shop: String(body?.shopCode ?? '').toUpperCase().slice(0, 8) })
        }
        return resultResponse(result, origin, allowedOrigin)
      }
      // ── スタッフ（段 2-1）。ログイン前の経路は IP 単位で総当たりを止める ──
      if (path === '/auth/staff-login' && request.method === 'POST') {
        const ip = clientIp(request)
        if (await isIpBlocked(env.DB, ip, 'login')) {
          return jsonResponse({ error: 'ログイン試行が多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
        }
        const body = await request.json().catch(() => ({}))
        const result = await handleStaffLogin(env.DB, body)
        if (result._status === 401) await recordIpFail(env.DB, ip, 'login')
        if (result._status === 401 || result._status === 429) {
          securityEvent(result._status === 429 ? 'staff_login_locked' : 'staff_login_failed', { ip, shop: String(body?.shopCode ?? '').toUpperCase().slice(0, 8) })
        }
        return resultResponse(result, origin, allowedOrigin)
      }
      if (path === '/auth/me' && request.method === 'GET') {
        return resultResponse(await handleMe(env.DB, request), origin, allowedOrigin)
      }
      if ((path === '/staff/invite' || path === '/staff/pending') && request.method === 'GET') {
        const ip = clientIp(request)
        if (await isIpBlocked(env.DB, ip, 'login')) {
          return jsonResponse({ error: '試行が多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
        }
        const result = path === '/staff/invite'
          ? await handleInviteInfo(env.DB, url.searchParams.get('token') ?? '')
          : await handleStaffPending(env.DB, url.searchParams.get('key') ?? '')
        if (result._status === 404) await recordIpFail(env.DB, ip, 'login')
        return resultResponse(result, origin, allowedOrigin)
      }
      if (path === '/staff/join' && request.method === 'POST') {
        const ip = clientIp(request)
        if (await isIpBlocked(env.DB, ip, 'login')) {
          return jsonResponse({ error: '試行が多すぎます。しばらく待ってから再度お試しください' }, 429, origin, allowedOrigin)
        }
        const result = await handleStaffJoin(env.DB, await request.json().catch(() => ({})))
        if (result._status === 404) await recordIpFail(env.DB, ip, 'login')
        if (result.pendingKey) {
          const job = notifyStaffJoin(env, result.shopCode, result.name).catch(e => console.warn('[push] staff join notify failed:', e?.message ?? e))
          if (ctx?.waitUntil) ctx.waitUntil(job)
        }
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
          // 画像（R2）も同じ削除で消す。失敗したら部屋の削除と同じく失敗として返す
          shopCode => Promise.all([purgeAccountRooms(env.ROOMS, shopCode), purgeShopImages(env.IMAGES, shopCode)]),
        )
        return resultResponse(result, origin, allowedOrigin)
      }
    }

    // ── 店舗 API ──────────────────────────────────────────────────────────────
    if (!env.DB) {
      // D1 未設定の場合はスキップ（既存機能に影響しない）
    } else {
      // POST /store/create（PIN の無い店舗を認証なしで作る旧経路）は廃止した。
      // 店舗は /auth/register（PIN 必須）でだけ作る。旧経路は誰でも無制限に店を作れ、
      // できた店は店舗コードだけで全データを読み書きできた。

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
          const cfg = await handleConfigGet(env.DB, code) ?? {}
          const money = await _canSeeMoney(env.DB, request, code)
          return jsonResponse(money ? cfg : stripConfigMoney(cfg), 200, origin, allowedOrigin)
        }
        if (subpath === '/config' && request.method === 'PUT') {
          let body = await request.json()
          // 何を変えたかで要る権限を決める（品目の削除・単価・並び替え・発注の設定。足すだけなら誰でも）
          const ctx = await authContext(env.DB, request)
          if (ctx && !ctx.isAdmin && ctx.role !== 'owner') {
            const prev = await handleConfigGet(env.DB, code) ?? {}
            // 金額を見られない人の端末には単価を渡していない。送られてきた単価は採らず、前の値を残す
            if (!ctxCan(ctx, 'money')) body = restoreConfigMoney(prev, body)
            const need = configChangePerms(prev, body)
            if (need.length) {
              const deny = await _requirePerm(env.DB, request, code, need, origin, allowedOrigin)
              if (deny) return deny
            }
          }
          return resultResponse(await handleConfigPut(env.DB, code, body), origin, allowedOrigin)
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
          const list = await handleHistoryGet(env.DB, code)
          const money = await _canSeeMoney(env.DB, request, code)
          return jsonResponse(money ? list : list.map(stripSnapshotMoney), 200, origin, allowedOrigin)
        }
        if (subpath === '/history' && request.method === 'POST') {
          let body = await request.json()
          // 金額を見られない人の端末は金額を落とした版を持っている（訂正・ロックで丸ごと送り直してくる）。
          // そのまま書くと在庫金額が消えるので、サーバーにある版から金額を戻す
          if (!(await _canSeeMoney(env.DB, request, code))) {
            body = restoreSnapshotMoney(await handleHistoryGetOne(env.DB, code, body), body)
          }
          return resultResponse(await handleHistoryPost(env.DB, code, body), origin, allowedOrigin)
        }
        // DELETE /store/:code/history/:key （key = sessionId または legacy日付）
        // resultResponse を通す＝ハンドラの 400/503 をそのままHTTPステータスへ出す。
        // jsonResponse(…, 200) では失敗が成功として届き、client が再試行できない。
        const histDateMatch = subpath.match(/^\/history\/([\w-]{1,64})$/)
        if (histDateMatch && request.method === 'DELETE') {
          const deny = await _requirePerm(env.DB, request, code, 'stock.discard', origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleHistoryDelete(env.DB, code, histDateMatch[1]), origin, allowedOrigin)
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
          const deny = await _requirePerm(env.DB, request, code, 'stock.discard', origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleOrderDelete(env.DB, code, orderDelMatch[1]), origin, allowedOrigin)
        }

        // GET/POST /store/:code/movements
        if (subpath === '/movements' && request.method === 'GET') {
          return jsonResponse(await handleMovementsGet(env.DB, code, url.searchParams.get('sinceDays')), 200, origin, allowedOrigin)
        }
        if (subpath === '/movements' && request.method === 'POST') {
          const body = await request.json()
          const who = await _actor(env.DB, request, code, body)
          if (who.staff) { body.by = who.name; body.byId = who.id }
          return resultResponse(await handleMovementCreate(env.DB, code, body), origin, allowedOrigin)
        }
        // DELETE /store/:code/movements/:id
        // 発注削除と同じく resultResponse を通す。ここだけ 200 固定だったため、
        // 404（他店舗・不存在）も 503（batch 巻き戻し）も本文だけの差になり、
        // client は削除できていないものを削除済みとして扱っていた。
        const moveDelMatch = subpath.match(/^\/movements\/([\w-]{1,64})$/)
        if (moveDelMatch && request.method === 'DELETE') {
          const deny = await _requirePerm(env.DB, request, code, 'stock.discard', origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleMovementDelete(env.DB, code, moveDelMatch[1]), origin, allowedOrigin)
        }

        // POST/DELETE /store/:code/push/subscribe（strict auth + bounded payload）
        if (subpath === '/push/subscribe' && (request.method === 'POST' || request.method === 'DELETE')) {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const parsed = await _readJsonBodyWithLimit(request, MAX_PUSH_SUBSCRIPTION_BYTES)
          if (parsed.error) return resultResponse(parsed.error, origin, allowedOrigin)
          const result = request.method === 'POST'
            ? await savePushSubscription(env.DB, code, parsed.body, (await _actor(env.DB, request, code, { byId: parsed.body?.byId })).id)
            : await deletePushSubscription(env.DB, code, parsed.body?.endpoint)
          return resultResponse(result, origin, allowedOrigin)
        }

        // ── スタッフの管理（段 2-1・管理者だけ。権限の確認は staffHandler の中）──
        // POST /store/:code/presence … アプリを開いている知らせ（90秒ごと・閉じるとき state:'off'。段 2-5）
        if (subpath === '/presence' && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const parsed = await _readJsonBodyWithLimit(request, 1024)
          const body = parsed.error ? {} : (parsed.body ?? {})
          const who = await _actor(env.DB, request, code, body)
          return resultResponse(await handlePresenceBeat(env.DB, code, who, body?.state === 'off' ? 'off' : 'on'), origin, allowedOrigin)
        }
        // GET /store/:code/presence?days=7 … いま開いている人・開いていた記録（管理者だけ）
        if (subpath === '/presence' && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const denyP = await _requirePerm(env.DB, request, code, 'monitor', origin, allowedOrigin)
          if (denyP) return denyP
          return jsonResponse(await handlePresenceGet(env.DB, code, url.searchParams.get('days')), 200, origin, allowedOrigin)
        }

        // GET /store/:code/staff/names … 担当を選ぶための名前（承認済みの人だけ。ログインしていれば誰でも・段 2-4）
        if (subpath === '/staff/names' && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const rows = (await env.DB.prepare("SELECT id, name FROM staff WHERE shop_code = ? AND status = 'active' ORDER BY created_at")
            .bind(code).all()).results ?? []
          return jsonResponse({ staff: rows.map(r => ({ id: r.id, name: r.name })) }, 200, origin, allowedOrigin)
        }
        if (subpath === '/staff' && request.method === 'GET') {
          return resultResponse(await handleStaffList(env.DB, request, code), origin, allowedOrigin)
        }
        if (subpath === '/staff/invites' && request.method === 'POST') {
          const parsed = await _readJsonBodyWithLimit(request, 4096)
          if (parsed.error) return resultResponse(parsed.error, origin, allowedOrigin)
          return resultResponse(await handleStaffInvite(env.DB, request, code, parsed.body), origin, allowedOrigin)
        }
        const invDel = subpath.match(/^\/staff\/invites\/(inv_[0-9a-f]{16})$/)
        if (invDel && request.method === 'DELETE') {
          return resultResponse(await handleStaffInviteRevoke(env.DB, request, code, invDel[1]), origin, allowedOrigin)
        }
        const stAct = subpath.match(/^\/staff\/(st_[0-9a-f]{16})\/(approve|reject|stop|resume|delete|role|grants|unlock)$/)
        if (stAct && request.method === 'POST') {
          const parsed = await _readJsonBodyWithLimit(request, 4096)
          const body = parsed.error ? {} : (parsed.body ?? {})
          const result = stAct[2] === 'unlock'
            ? await handleStaffUnlock(env.DB, request, code, stAct[1])
            : await handleStaffAction(env.DB, request, code, stAct[1], stAct[2], body)
          return resultResponse(result, origin, allowedOrigin)
        }

        // PUT /store/:code/push/prefs … この端末の通知の設定 / POST /store/:code/push/test … 試しの通知
        if ((subpath === '/push/prefs' && request.method === 'PUT') || (subpath === '/push/test' && request.method === 'POST')) {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const parsed = await _readJsonBodyWithLimit(request, MAX_PUSH_SUBSCRIPTION_BYTES)
          if (parsed.error) return resultResponse(parsed.error, origin, allowedOrigin)
          const result = subpath === '/push/prefs'
            ? await savePushPrefs(env.DB, code, parsed.body, (await _actor(env.DB, request, code, { byId: parsed.body?.byId })).id)
            : await sendTestPush(env, code, parsed.body)
          return resultResponse(result, origin, allowedOrigin)
        }

        // POST /store/:code/images … 品目の画像を保存（要認証・端末で圧縮済みの thumb / full）
        if (subpath === '/images' && request.method === 'POST') {
          const deny = await _requirePerm(env.DB, request, code, 'item.edit', origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleImageUpload(env.IMAGES, code, request), origin, allowedOrigin)
        }
        // DELETE /store/:code/images/:id （要認証）
        const imageDelMatch = subpath.match(/^\/images\/([0-9a-f]{32})$/)
        if (imageDelMatch && request.method === 'DELETE') {
          const deny = await _requirePerm(env.DB, request, code, 'item.edit', origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleImageDelete(env.IMAGES, code, imageDelMatch[1]), origin, allowedOrigin)
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
          const denyP = await _requirePerm(env.DB, request, code, body?.type === 'order' ? 'order.start' : 'stock.start', origin, allowedOrigin)
          if (denyP) return denyP
          // resultResponse を通す。jsonResponse(…, 200) だと handler の
          // `{ _status: 400, code:'invalid_type' }` が HTTP 200 で届き、client は
          // 作成できていないセッションを作成済みとして扱う（DATA-002 §4）。
          // `_status` は resultResponse が本文から取り除く。
          const created = await handleSessionCreate(env.DB, code, body)
          if (!created?._status) {
            const who = await _actor(env.DB, request, code, body)
            if (who.name || who.id) {
              await env.DB.prepare('UPDATE sessions SET started_by = ?, started_by_id = ? WHERE id = ? AND shop_code = ?')
                .bind(who.name, who.id, created.id, code).run()
              created.startedBy = who.name
            }
          }
          return resultResponse(created, origin, allowedOrigin)
        }

        // GET/POST /store/:code/tasks … カレンダーのやること（要認証）
        if (subpath === '/tasks' && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return jsonResponse(await handleTasksGet(env.DB, code, url.searchParams.get('sinceDays')), 200, origin, allowedOrigin)
        }
        if (subpath === '/tasks' && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const body = await request.json().catch(() => ({}))
          // 新しく作る・消すは「やることを作る」権限。完了の印だけなら誰でも
          const prevTask = typeof body?.id === 'string'
            ? await env.DB.prepare('SELECT deleted_at, assign_mode, assignee_id, body, task_date, due_time FROM tasks WHERE id = ? AND shop_code = ?').bind(body.id, code).first()
            : null
          // 担当を変えるのも「作る」側の操作（段 2-4）
          const assignChanged = prevTask && ((prevTask.assign_mode ?? 'anyone') !== (body?.assign ?? 'anyone')
            || (body?.assign === 'person' && (prevTask.assignee_id ?? '') !== (body?.assigneeId ?? '')))
          // 文面・日付・時刻を直すのも「作る」側（TODO 本格化 A）
          const edited = prevTask && ((prevTask.body ?? '') !== String(body?.text ?? '').trim().slice(0, 200)
            || (prevTask.task_date ?? '') !== (body?.date ?? '') || (prevTask.due_time ?? null) !== (body?.dueTime || null))
          if (!prevTask || (body?.deletedAt && !prevTask.deleted_at) || assignChanged || edited) {
            const denyP = await _requirePerm(env.DB, request, code, 'task.create', origin, allowedOrigin)
            if (denyP) return denyP
          }
          // スタッフは本人の名前で刻む（作った人・完了した人）
          const who = await _actor(env.DB, request, code, {})
          if (who.staff && body && typeof body === 'object') {
            body.createdBy = who.name; body.createdById = who.id
            if (body.doneAt) { body.doneBy = who.name; body.doneById = who.id }
          }
          const result = await handleTaskUpsert(env.DB, code, body)
          // 新しく追加されたときだけ、他の端末へ通知（応答は待たせない）
          const except = typeof body.pushEndpoint === 'string' ? body.pushEndpoint : ''
          if (result?.created && result.task) {
            const job = notifyTaskAdded(env, code, result.task, except)
              .catch(e => console.warn('[push] task notify failed:', e?.message ?? e))
            if (ctx?.waitUntil) ctx.waitUntil(job)
          }
          // 担当の人になった（新しく作った・担当を変えた）ときは、その人の端末にだけ知らせる
          const newlyAssigned = result?.task?.assign === 'person' && !result.stale && !result.task.deletedAt
            && (result.created || (prevTask && (prevTask.assign_mode !== 'person' || prevTask.assignee_id !== result.task.assigneeId)))
          if (newlyAssigned) {
            const job = notifyTaskAssigned(env, code, result.task, except)
              .catch(e => console.warn('[push] task assign notify failed:', e?.message ?? e))
            if (ctx?.waitUntil) ctx.waitUntil(job)
          }
          const { task: _t, ...rest } = result ?? {}
          return resultResponse(rest, origin, allowedOrigin)
        }

        // POST /store/:code/tasks/:id/mark … 「全員」のやることに自分の印（段 2-4。印は誰でも）
        const taskMark = subpath.match(/^\/tasks\/([\w-]{1,64})\/mark$/)
        if (taskMark && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const body = await request.json().catch(() => ({}))
          const who = await _actor(env.DB, request, code, body)
          return resultResponse(await handleTaskMark(env.DB, code, taskMark[1], who, !!body?.done), origin, allowedOrigin)
        }

        // GET /store/:code/sessions/discarded … 24時間以内に破棄した（取り戻せる）セッション（要認証）
        if (subpath === '/sessions/discarded' && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          return resultResponse(await handleDiscardedList(env.DB, code), origin, allowedOrigin)
        }
        // POST /store/:code/sessions/purge-unfinished … 品目マスタの一括削除に合わせて、
        // 完了していない棚卸・発注（中断中・取り戻せる破棄）を完全に消す（要認証）
        if (subpath === '/sessions/purge-unfinished' && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const denyP = await _requirePerm(env.DB, request, code, 'item.admin', origin, allowedOrigin)
          if (denyP) return denyP
          return resultResponse(await handlePurgeUnfinished(env.DB, code), origin, allowedOrigin)
        }
        // POST /store/:code/sessions/:id/restore … 破棄を取り消す（要認証）
        const restoreMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})\/restore$/)
        if (restoreMatch && request.method === 'POST') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const denyP = await _requirePerm(env.DB, request, code, 'stock.discard', origin, allowedOrigin)
          if (denyP) return denyP
          return resultResponse(await handleSessionRestore(env.DB, code, restoreMatch[1]), origin, allowedOrigin)
        }

        // PUT/DELETE /store/:code/sessions/:id （要認証）
        const sessMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})$/)
        if (sessMatch && request.method === 'PUT') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const denyP = await _requirePerm(env.DB, request, code, (await _sessionType(env.DB, code, sessMatch[1])) === 'order' ? 'order.start' : 'stock.start', origin, allowedOrigin)
          if (denyP) return denyP
          return resultResponse(await handleSessionUpdate(env.DB, code, sessMatch[1], await request.json()), origin, allowedOrigin)
        }
        if (sessMatch && request.method === 'DELETE') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const denyP = await _requirePerm(env.DB, request, code, 'stock.discard', origin, allowedOrigin)
          if (denyP) return denyP
          // 本文（取り戻すための下書き）は任意。無い・読めないときは空として扱う
          let body = {}
          try { const t = await request.text(); body = t ? JSON.parse(t) : {} } catch (_) { body = {} }
          return resultResponse(await handleSessionDelete(env.DB, code, sessMatch[1], body), origin, allowedOrigin)
        }

        // GET /store/:code/sessions/:id/lines （要認証）
        // 端末に snapshot が無くても完了済み棚卸の詳細を開けるようにする（DATA-002 Phase 1）。
        // 単価・在庫金額を含むためゲストには出さない。ここは店舗トークン必須の側に置く。
        const sessLinesMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})\/lines$/)
        if (sessLinesMatch && request.method === 'GET') {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          const lines = await handleSessionLinesGet(env.DB, code, sessLinesMatch[1])
          const money = await _canSeeMoney(env.DB, request, code)
          return resultResponse(money ? lines : stripLinesMoney(lines), origin, allowedOrigin)
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
          const denyP = await _requirePerm(env.DB, request, code, 'item.admin', origin, allowedOrigin)
          if (denyP) return denyP
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
          const denyP = await _requirePerm(env.DB, request, code, 'item.admin', origin, allowedOrigin)
          if (denyP) return denyP
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
          const denyP = await _requirePerm(env.DB, request, code, (await _sessionType(env.DB, code, sessCompleteMatch[1])) === 'order' ? 'order.finish' : 'stock.finish', origin, allowedOrigin)
          if (denyP) return denyP
          const body = await request.json()
          // 金額を見られない人の端末は単価を持っていない。完了の単価は店の品目リスト（サーバー）から取る。
          // 端末の値（空）で完了すると、その棚卸の在庫金額が記録されない
          const money = await _canSeeMoney(env.DB, request, code)
          if (!money && body && typeof body === 'object') {
            body.prices = { ...((await handleConfigGet(env.DB, code))?.prices ?? {}) }
          }
          const done = await handleSessionComplete(env.DB, code, sessCompleteMatch[1], body)
          if (!money && done && !done._status && 'totalValue' in done) done.totalValue = null
          if (!done?._status) {
            // 完了した人（最初に完了させた人だけ。同じ完了の再送では書き換えない）
            const who = await _actor(env.DB, request, code, { by: url.searchParams.get('by'), byId: url.searchParams.get('byId') })
            if (who.name || who.id) {
              await env.DB.prepare(`UPDATE sessions SET completed_by = ?, completed_by_id = ?
                WHERE id = ? AND shop_code = ? AND status = 'completed' AND completed_by IS NULL AND completed_by_id IS NULL`)
                .bind(who.name, who.id, sessCompleteMatch[1], code).run()
            }
          }
          return resultResponse(done, origin, allowedOrigin)
        }

        // /store/:code/sessions/:id/audit … 操作ログ（変更履歴・migration 0017、要認証）
        //   POST … まとめて追記（同じ id の再送は無視＝冪等）
        //   GET  … 別端末から読む
        const sessAuditMatch = subpath.match(/^\/sessions\/([0-9a-f-]{36})\/audit$/)
        if (sessAuditMatch && (request.method === 'POST' || request.method === 'GET')) {
          const deny = await _requireAuth(env.DB, request, code, origin, allowedOrigin)
          if (deny) return deny
          if (request.method === 'GET') {
            return resultResponse(await handleAuditGet(env.DB, code, sessAuditMatch[1]), origin, allowedOrigin)
          }
          return resultResponse(
            await handleAuditAppend(env.DB, code, sessAuditMatch[1], await request.json()),
            origin, allowedOrigin,
          )
        }
      }
    }

    // ── プッシュ通知 ───────────────────────────────────────────────────────────
    if (path === '/api/push/vapid-key' && request.method === 'GET') {
      return jsonResponse({ key: env.VAPID_PUBLIC_KEY || null }, 200, origin, allowedOrigin)
    }

    // POST /pdf（サーバーでのPDF解析）は廃止した（User決定 2026-10-08・DS-07）。
    // App は端末内の pdfjs で解析しており、呼び出しは無かった。Worker に pdfjs を置かないことで、
    // 細工したPDFを解析させる経路（pdfjs-dist の既知の脆弱性を含む）そのものを無くす。

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
        // 最近の変更（品目名・数量・名前）と sessionId は、この店にログインしている端末にだけ渡す。
        // sessionId はゲスト参加の鍵（joinSessionId）と完了結果リンクの鍵を兼ねるため、
        // 店舗コードだけで読めると招待リンク無しでルームへ入れてしまう。
        // 未ログインの端末には、リンクで同じ ID を既に持っている（?s= が一致する）ときだけ返す。
        if (action === 'status' && body && typeof body === 'object') {
          const authCode = await verifyAuth(env.DB, request).catch(() => null)
          if (authCode !== code) {
            delete body.recent
            const s = url.searchParams.get('s')
            if (!s || s !== body.sessionId) delete body.sessionId
          }
        }
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
      // 内部の例外メッセージ（SQL・テーブル名・ライブラリの文言）は利用者へ返さない。log にだけ残す
      console.error('[Worker] Unhandled error:', request.method, path, e?.message ?? e)
      securityEvent('internal_error', { method: request.method, path })
      return jsonResponse({ code: 'internal_error', error: 'サーバーでエラーが発生しました。しばらく待ってから再度お試しください' }, 500, origin, allowedOrigin)
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env))
  },
}
