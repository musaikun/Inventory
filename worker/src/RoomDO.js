import {
  ROOM_TTL_MS, MAX_PARTICIPANTS, MAX_AUDIT_LOG,
  WS_RATE_WINDOW_MS, WS_RATE_MAX_MSG,
  MAX_TOKEN_LEN, MAX_DEVICE_ID_LEN, MAX_DEVICE_NAME_LEN,
  MAX_INGREDIENT_LEN, MAX_UNIT_LEN, MAX_CHAT_TEXT_LEN, MAX_ORDER_QTY,
  ACCOUNT_DELETION_INTERNAL_HEADER,
} from './constants.js'
import { verifyAuthToken } from './authHandler.js'

// 発注スケジュールの正規化（client useConfig の _normSchedule と一致させる）。
// days = 0..6 の整数配列（重複除去）／deadline = 'HH:MM' 形式のみ許可。
function _normSchedule(s) {
  const days = Array.isArray(s?.days)
    ? [...new Set(s.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))]
    : []
  const deadline = /^\d{1,2}:\d{2}$/.test(s?.deadline || '') ? s.deadline : ''
  return { days, deadline }
}

// ホスト権限を（再）発行してよいかの判定。純関数・テスト容易化のため抽出。
// protectedStore = PIN設定済み店舗（D1認証で守る）。この場合トポロジ（空室・同端末・
// 他ホスト不在）は信用せず、D1トークンの検証結果 authOk のみで判断する。
// レガシー店舗（PIN未設定）は後方互換で従来のトポロジ判定を維持する。
//   ① 空室（再初期化） ② 同一 deviceId のホスト残存（本人のオフライン復帰）
//   ③ 他にホスト権限を持つ接続が無い（ホスト不在ルームの引き継ぎ）
export function canGrantHost({ protectedStore, authOk, isEmpty, sameDeviceHost, anyVerifiedHost }) {
  if (protectedStore) return authOk === true
  return isEmpty || sameDeviceHost || !anyVerifiedHost
}

// 品目リスト設定として保存・中継する全フィールドを一箇所で正規化する。
// App.vue の getter（registerConfigGetter）が送る全フィールドと1:1で対応させること。
// ここに列挙漏れがあると、ホストの品目更新でゲスト側の軸/非表示等が消える。
export function normalizeConfig(src = {}) {
  return {
    order:         Array.isArray(src.order) ? src.order : [],
    isCustom:      !!src.isCustom,
    units:         src.units         ?? {},
    prices:        src.prices        ?? {},
    categories:    src.categories    ?? {},
    codes:         src.codes         ?? {},
    categoryCodes: src.categoryCodes ?? {},
    prevMonths:    src.prevMonths    ?? {},
    lotSizes:      src.lotSizes      ?? {},
    reorderPoints: src.reorderPoints ?? {},
    orderSchedule: _normSchedule(src.orderSchedule),
    dictionary:    src.dictionary    ?? {},
    manualItems:   Array.isArray(src.manualItems) ? src.manualItems : [],
    axisNames:     Array.isArray(src.axisNames) ? src.axisNames : ['', ''],
    tagsA:         src.tagsA         ?? {},
    tagsB:         src.tagsB         ?? {},
    axisGroupsA:   Array.isArray(src.axisGroupsA) ? src.axisGroupsA : [],
    axisGroupsB:   Array.isArray(src.axisGroupsB) ? src.axisGroupsB : [],
    hiddenItems:   Array.isArray(src.hiddenItems) ? src.hiddenItems : [],
    hiddenAuto:    Array.isArray(src.hiddenAuto) ? src.hiddenAuto : [],
    tagsArchiveA:  src.tagsArchiveA ?? {},
    tagsArchiveB:  src.tagsArchiveB ?? {},
  }
}

export class RoomDO {
  constructor(state, env) {
    this.state = state
    this.env   = env
    this._itemAddRequests = new Map()  // requestId → requesting WS (in-memory only)
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/internal/account-delete') {
      return this._handleAccountDelete(request)
    }
    // このDOが担当する店舗コードをパスから記録する（Worker 層で存在検証済み・
    // ルームID = 店舗コードの統一設計により、パスのコード＝このDOの正体）。
    // ホスト認証（PIN設定店舗のD1トークン照合）で自分の店舗コードとして使う。
    const codeMatch = url.pathname.match(/\/room\/([A-Za-z0-9]{4,8})\//)
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase()
      const existing = await this.state.storage.get('shopCode')
      if (existing !== code) await this.state.storage.put('shopCode', code)
    }
    // HTTP 経由のルーム解散（ホストが退室済みで WS 未接続の残存ルームを掃除する）
    if (url.pathname.endsWith('/dissolve')) {
      return this._handleHttpDissolve(request)
    }
    // HTTP 経由のルーム状態取得（ホストが退室中もゲストのライブ品目数を一覧に表示する）
    if (url.pathname.endsWith('/status')) {
      return this._handleHttpStatus()
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    this.state.acceptWebSocket(server)
    const alarm = await this.state.storage.getAlarm()
    if (!alarm) await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS)
    return new Response(null, { status: 101, webSocket: client })
  }

  async _handleAccountDelete(request) {
    if (request.method !== 'DELETE') return new Response('Method Not Allowed', { status: 405 })
    if (request.headers.get('X-Inventory-Internal-Action') !== ACCOUNT_DELETION_INTERNAL_HEADER) {
      return new Response('Forbidden', { status: 403 })
    }

    this._broadcast({ type: 'account_deleted' })
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.serializeAttachment({ leftCleanly: true })
        ws.close(1000, 'Account deleted')
      } catch (_) {}
    }
    this._itemAddRequests.clear()
    await this.state.storage.deleteAlarm()
    await this.state.storage.deleteAll()
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async _handleHttpDissolve(request) {
    const json = (body, status) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    let body = {}
    try { body = await request.json() } catch (_) {}

    const storedToken = await this.state.storage.get('hostToken')
    // ルームが存在しない（既に解散済み）: 成功扱い
    if (!storedToken) return json({ ok: true, alreadyGone: true }, 200)

    const providedToken = String(body.hostToken ?? '').slice(0, MAX_TOKEN_LEN)
    if (providedToken !== storedToken) return json({ error: 'auth_failed' }, 403)

    // 全クライアントへ解散通知して切断、ストレージを破棄
    this._broadcast({ type: 'dissolved' })
    for (const w of this.state.getWebSockets()) {
      try { w.close(1000, 'Room dissolved') } catch (_) {}
    }
    await this.state.storage.deleteAll()
    return json({ ok: true }, 200)
  }

  async _handleHttpStatus() {
    const [inventory, orders, isActive, sessionId, config, hostToken] = await Promise.all([
      this.state.storage.get('inventory').then(v => v ?? {}),
      this.state.storage.get('orders').then(v => v ?? {}),
      this.state.storage.get('isActive').then(v => v ?? false),
      this.state.storage.get('sessionId').then(v => v ?? ''),
      this.state.storage.get('config').then(v => v ?? null),
      this.state.storage.get('hostToken').then(v => v ?? null),
    ])
    const participants = this._getParticipants().map(p => ({
      name:   p.deviceName ?? '名前未設定',
      isHost: !!p.isHost,
      isDone: !!p.isDone,
    }))
    return new Response(JSON.stringify({
      sessionId,
      isActive,
      itemCount:      Object.keys(inventory).length,
      orderItemCount: Object.keys(orders).length,
      totalItems:  Array.isArray(config?.order) ? config.order.length : null,
      participants,
      clientCount: participants.length,
      roomExists:  !!hostToken || isActive || participants.length > 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  async webSocketMessage(ws, message) {
    let msg
    try { msg = JSON.parse(message) } catch { return }

    try {
      await this._handleMessage(ws, msg)
    } catch (err) {
      console.error('[RoomDO] error:', msg?.type, err)
    }
  }

  async _handleMessage(ws, msg) {
    const type = typeof msg?.type === 'string' ? msg.type : ''
    const isJoined = this._isJoined(ws)

    // WebSocket upgrade 自体は公開経路のため、join が成功するまでは room data への
    // 読み書きを一切許可しない。認可状態は attachment に置き、hibernation 後も維持する。
    if (type === 'join' && isJoined) {
      ws.send(JSON.stringify({ type: 'error', code: 'already_joined' }))
      return
    }
    if (type !== 'join' && type !== 'ping' && !isJoined) {
      ws.send(JSON.stringify({ type: 'error', code: 'join_required' }))
      ws.close(1008, 'Join required')
      return
    }

    // 未参加 ping は疎通確認だけ許可し、ルーム寿命は延長させない。
    if (type !== 'ping' || isJoined) {
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS)
    }

    if (type !== 'ping' && type !== 'join') {
      const att   = ws.deserializeAttachment() ?? {}
      const now   = Date.now()
      const start = att._rlTime ?? 0
      const count = att._rlCount ?? 0
      if (now - start <= WS_RATE_WINDOW_MS) {
        if (count >= WS_RATE_MAX_MSG) return
        ws.serializeAttachment({ ...att, _rlCount: count + 1 })
      } else {
        ws.serializeAttachment({ ...att, _rlTime: now, _rlCount: 1 })
      }
    }

    switch (msg.type) {
      case 'join': {
        const deviceId   = String(msg.deviceId   ?? '').trim().slice(0, MAX_DEVICE_ID_LEN)
        const deviceName = String(msg.deviceName ?? '').slice(0, MAX_DEVICE_NAME_LEN)
        const role       = msg.role === 'host' ? 'host' : 'guest'

        if (!deviceId) {
          ws.send(JSON.stringify({ type: 'error', code: 'invalid_device_id' }))
          ws.close(1008, 'Invalid device ID')
          return
        }

        let isVerifiedHost = false
        let newHostToken   = null   // 初回発行時のみ送り返す

        if (role === 'host') {
          const storedToken   = await this.state.storage.get('hostToken')
          const providedToken = String(msg.hostToken ?? '').slice(0, MAX_TOKEN_LEN)

          if (storedToken && providedToken === storedToken) {
            // 再接続: hostToken 一致（発行済みの能力トークン）→ 承認（D1照合は不要）
            isVerifiedHost = true
          } else {
            // hostToken 不一致 or 未発行（初回・復旧）: ホスト権限の（再）発行判定。
            // PIN設定店舗は D1 認証トークンの検証を必須にし、店舗コードを知るだけの
            // 第三者がホスト不在時に乗っ取れる穴（監査 S-A）を塞ぐ。
            const shopCode       = await this.state.storage.get('shopCode')
            const protectedStore = await this._isStoreProtected(shopCode)
            const authOk         = protectedStore
              ? await this._hostAuthOk(shopCode, msg.authToken)
              : false

            const others = this.state.getWebSockets().filter(w => w !== ws && this._isJoined(w))
            const sameDeviceHost  = others.some(w => {
              const a = w.deserializeAttachment()
              return a?.deviceId === deviceId && a?.isHost
            })
            const anyVerifiedHost = others.some(w => w.deserializeAttachment()?.isHost)

            if (canGrantHost({ protectedStore, authOk, isEmpty: others.length === 0, sameDeviceHost, anyVerifiedHost })) {
              const token = crypto.randomUUID()
              await this.state.storage.put('hostToken', token)
              isVerifiedHost = true
              newHostToken   = token
            } else {
              ws.send(JSON.stringify({ type: 'error', code: 'auth_failed' }))
              ws.close(1008, 'Host authentication failed')
              return
            }
          }
          await this.state.storage.put('initialized', true)
        } else {
          // ゲストのみ: セッションアクティブチェック
          const isActive = await this.state.storage.get('isActive')
          if (!isActive) {
            ws.send(JSON.stringify({ type: 'error', code: 'session_not_active' }))
            ws.close(1008, 'Session not active')
            return
          }
          // 招待リンク検証: 現在のセッションIDと一致する鍵を持つゲストのみ許可。
          // 古いURL（別セッションID）や鍵なし参加（店舗コード手入力）は拒否する。
          const sid = await this.state.storage.get('sessionId')
          if (sid) {
            const provided = String(msg.joinSessionId ?? '')
            if (provided !== sid) {
              ws.send(JSON.stringify({ type: 'error', code: 'invalid_link' }))
              ws.close(1008, 'Invalid invite link')
              return
            }
          }
        }

        const existingIds = new Set(
          this.state.getWebSockets()
            .filter(w => w !== ws && this._isJoined(w))
            .map(w => w.deserializeAttachment()?.deviceId)
            .filter(Boolean)
        )
        if (!existingIds.has(deviceId) && existingIds.size >= MAX_PARTICIPANTS) {
          ws.send(JSON.stringify({ type: 'error', code: 'room_full' }))
          ws.close(1008, 'Room full')
          return
        }

        // 端末名重複チェック（同じ deviceId のセッション復帰は除外）
        if (deviceName) {
          const existingNames = new Set(
            this.state.getWebSockets()
              .filter(w => w !== ws && this._isJoined(w))
              .filter(w => w.deserializeAttachment()?.deviceId !== deviceId)
              .map(w => w.deserializeAttachment()?.deviceName)
              .filter(Boolean)
          )
          if (existingNames.has(deviceName)) {
            ws.send(JSON.stringify({ type: 'error', code: 'name_taken' }))
            ws.close(1008, 'Name already taken')
            return
          }
        }

        // セッション復帰: 同じ deviceId の既存 WS を閉じる
        // close() の後 webSocketClose コールバックは非同期で発火するため、
        // その前に attachment を無効化して _getParticipants() からゾンビを即時除外する。
        for (const existingWs of this.state.getWebSockets()) {
          if (existingWs === ws) continue
          const att = existingWs.deserializeAttachment()
          if (this._isJoined(existingWs) && att?.deviceId === deviceId) {
            try {
              existingWs.serializeAttachment({ leftCleanly: true })  // deviceId を除去してゾンビを即時非表示
              existingWs.close(1000, 'Session recovered')
            } catch (_) {}
          }
        }

        ws.serializeAttachment({ joined: true, deviceId, deviceName, isHost: isVerifiedHost })

        const [inventory, orders, recountFlags, config, messages, auditLog, isActive, sessionId] = await Promise.all([
          this.state.storage.get('inventory').then(v => v ?? {}),
          this.state.storage.get('orders').then(v => v ?? {}),
          this.state.storage.get('recountFlags').then(v => v ?? {}),
          this.state.storage.get('config').then(v => v ?? null),
          this.state.storage.get('messages').then(v => v ?? []),
          this.state.storage.get('auditLog').then(v => v ?? []),
          this.state.storage.get('isActive').then(v => v ?? false),
          this.state.storage.get('sessionId').then(v => v ?? ''),
        ])
        const participants = this._getParticipants()

        const joinedMsg = {
          type: 'joined', inventory, orders, recountFlags, config, participants, messages, auditLog,
          isSessionActive: isActive, sessionId,
          ...(newHostToken ? { hostToken: newHostToken } : {}),
        }
        // ゲストには単価を渡さない（S-G）。ホスト検証済みのみ全量。
        ws.send(JSON.stringify(isVerifiedHost ? joinedMsg : this._stripPricesForGuest(joinedMsg)))
        this._broadcast({ type: 'participants', list: this._getParticipants() }, ws)
        break
      }

      case 'config': {
        if (!this._isHost(ws)) return
        if (!Array.isArray(msg.order)) return
        const stored = normalizeConfig(msg)   // 軸・非表示等を含む全フィールドを保存/中継
        await this.state.storage.put('config', stored)
        // ゲスト全員に品目リスト更新を通知（ゲストには prices を落とす・S-G）
        this._broadcastPriceAware({ type: 'config_update', ...stored }, ws)
        break
      }

      case 'update': {
        const { ingredient, qty, unit, enteredBy, isAdd } = msg
        if (!ingredient || typeof qty !== 'number') return
        if (String(ingredient).length > MAX_INGREDIENT_LEN) return

        const [inventory, auditLog] = await Promise.all([
          this.state.storage.get('inventory').then(v => v ?? {}),
          this.state.storage.get('auditLog').then(v => v ?? []),
        ])

        const prev = inventory[ingredient]
        const prevQty = prev?.qty ?? null
        let action
        if (prevQty === null) {
          action = 'new'
        } else if (isAdd) {
          action = 'add'
        } else {
          action = 'overwrite'
        }
        const delta = action === 'add' ? qty - (prevQty ?? 0) : qty

        inventory[ingredient] = {
          qty,
          unit:      unit      ?? '',
          enteredBy: String(enteredBy ?? '').slice(0, MAX_DEVICE_NAME_LEN),
          updatedAt: Date.now(),
        }

        const att = ws.deserializeAttachment() ?? {}
        const entry = this._appendAudit(auditLog, {
          ingredient,
          action,
          delta,
          totalQty:    qty,
          unit:        unit ?? '',
          enteredBy:   String(enteredBy ?? '').slice(0, MAX_DEVICE_NAME_LEN),
          enteredById: att.deviceId ?? '',
        })

        await Promise.all([
          this.state.storage.put('inventory', inventory),
          this.state.storage.put('auditLog', auditLog),
        ])

        const { deviceId } = att
        this._broadcast({ type: 'audit_entry', entry })
        this._broadcast(
          { type: 'update', ingredient, qty, unit: unit ?? '', enteredBy: enteredBy ?? '', fromDeviceId: deviceId },
          ws,
        )
        break
      }

      case 'remove': {
        const { ingredient } = msg
        if (!ingredient || String(ingredient).length > MAX_INGREDIENT_LEN) return

        const [inventory, auditLog] = await Promise.all([
          this.state.storage.get('inventory').then(v => v ?? {}),
          this.state.storage.get('auditLog').then(v => v ?? []),
        ])

        const prev = inventory[ingredient]
        if (prev) {
          const att = ws.deserializeAttachment() ?? {}
          const entry = this._appendAudit(auditLog, {
            ingredient,
            action:      'remove',
            delta:       -(prev.qty ?? 0),
            totalQty:    0,
            unit:        prev.unit ?? '',
            enteredBy:   att.deviceName ?? '',
            enteredById: att.deviceId  ?? '',
          })
          this._broadcast({ type: 'audit_entry', entry })
          await this.state.storage.put('auditLog', auditLog)
        }

        delete inventory[ingredient]
        await this.state.storage.put('inventory', inventory)

        const { deviceId } = ws.deserializeAttachment() ?? {}
        this._broadcast({ type: 'remove', ingredient, fromDeviceId: deviceId }, ws)
        break
      }

      // ── 発注数の同期（発注ルーム専用・在庫の update とは別マップ 'orders'）──────
      case 'order_update': {
        const { ingredient, orderQty, unit, lot, enteredBy } = msg
        if (!ingredient || typeof orderQty !== 'number') return
        if (String(ingredient).length > MAX_INGREDIENT_LEN) return
        // 有限・上限ガード（R2-05）。0以下は「取り消し」で防御的に無視、Infinity/巨大値も弾く
        // （JSON化で null 化して壊れるのを防ぐ）。取り消しは order_remove を使う想定。
        if (!Number.isFinite(orderQty) || orderQty <= 0 || orderQty > MAX_ORDER_QTY) return

        const [orders, auditLog] = await Promise.all([
          this.state.storage.get('orders').then(v => v ?? {}),
          this.state.storage.get('auditLog').then(v => v ?? []),
        ])

        const att      = ws.deserializeAttachment() ?? {}
        const cleanBy  = String(enteredBy ?? att.deviceName ?? '').slice(0, MAX_DEVICE_NAME_LEN)
        const cleanUnit = String(unit ?? '').slice(0, MAX_UNIT_LEN)
        const cleanLot  = Number.isFinite(Number(lot)) && Number(lot) > 0 ? Number(lot) : 1

        orders[ingredient] = {
          orderQty,
          unit:        cleanUnit,
          lot:         cleanLot,
          enteredBy:   cleanBy,
          enteredById: att.deviceId ?? '',
          updatedAt:   Date.now(),
        }

        const entry = this._appendAudit(auditLog, {
          ingredient,
          action:      'order_set',
          delta:       0,
          totalQty:    orderQty,
          unit:        cleanUnit,
          enteredBy:   cleanBy,
          enteredById: att.deviceId ?? '',
        })

        await Promise.all([
          this.state.storage.put('orders', orders),
          this.state.storage.put('auditLog', auditLog),
        ])

        this._broadcast({ type: 'audit_entry', entry })
        this._broadcast(
          { type: 'order_update', ingredient, orderQty, unit: cleanUnit, lot: cleanLot, enteredBy: cleanBy, fromDeviceId: att.deviceId ?? '' },
          ws,
        )
        break
      }

      case 'order_remove': {
        const { ingredient } = msg
        if (!ingredient || String(ingredient).length > MAX_INGREDIENT_LEN) return

        const [orders, auditLog] = await Promise.all([
          this.state.storage.get('orders').then(v => v ?? {}),
          this.state.storage.get('auditLog').then(v => v ?? []),
        ])

        const att  = ws.deserializeAttachment() ?? {}
        const prev = orders[ingredient]
        if (prev) {
          const entry = this._appendAudit(auditLog, {
            ingredient,
            action:      'order_clear',
            delta:       0,
            totalQty:    0,
            unit:        prev.unit ?? '',
            enteredBy:   att.deviceName ?? '',
            enteredById: att.deviceId  ?? '',
          })
          this._broadcast({ type: 'audit_entry', entry })
          delete orders[ingredient]
          await Promise.all([
            this.state.storage.put('orders', orders),
            this.state.storage.put('auditLog', auditLog),
          ])
        }

        this._broadcast({ type: 'order_remove', ingredient, fromDeviceId: att.deviceId ?? '' }, ws)
        break
      }

      case 'recount_flag': {
        const ingredient = String(msg.ingredient ?? '')
        if (!ingredient || ingredient.length > MAX_INGREDIENT_LEN) return
        const on  = !!msg.on
        const att = ws.deserializeAttachment() ?? {}

        const flags = (await this.state.storage.get('recountFlags')) ?? {}
        const was   = !!flags[ingredient]
        // 状態変化なし（ホスト再接続時の再送など）: 監査ログは増やさず同期のみ
        if (on === was) {
          this._broadcast({ type: 'recount_flag', ingredient, on, fromDeviceId: att.deviceId ?? '' }, ws)
          break
        }

        const at = Date.now()
        if (on) flags[ingredient] = { by: String(att.deviceName ?? '').slice(0, MAX_DEVICE_NAME_LEN), at }
        else    delete flags[ingredient]

        const inventory = (await this.state.storage.get('inventory')) ?? {}
        const cur       = inventory[ingredient]
        const auditLog  = (await this.state.storage.get('auditLog')) ?? []
        const entry = this._appendAudit(auditLog, {
          ingredient,
          action:      on ? 'flag_recount' : 'unflag_recount',
          delta:       0,
          totalQty:    cur?.qty ?? 0,
          unit:        cur?.unit ?? '',
          enteredBy:   String(att.deviceName ?? '').slice(0, MAX_DEVICE_NAME_LEN),
          enteredById: att.deviceId ?? '',
          timestamp:   at,
        })

        await Promise.all([
          this.state.storage.put('recountFlags', flags),
          this.state.storage.put('auditLog', auditLog),
        ])

        this._broadcast({ type: 'audit_entry', entry })
        this._broadcast({ type: 'recount_flag', ingredient, on, enteredBy: entry.enteredBy, at, fromDeviceId: att.deviceId ?? '' }, ws)
        break
      }

      case 'leave': {
        // クリーン退出フラグを立て、webSocketClose での二重ブロードキャストを防ぐ
        // joined/deviceId も除去し、このメッセージ以降の操作・受信を即時停止する。
        ws.serializeAttachment({ leftCleanly: true })
        // 退出を即時通知: TCP クローズ検出を待たず参加者リストを更新してブロードキャスト
        this._broadcast({ type: 'participants', list: this._getParticipants() }, ws)
        break
      }

      case 'done': {
        const att = ws.deserializeAttachment() ?? {}
        const isFinal = !!(msg.isFinal ?? false)
        if (!isFinal) {
          ws.serializeAttachment({ ...att, isDone: true })
        }
        this._broadcast({
          type:         'done',
          deviceName:   att.deviceName ?? '名前未設定',
          fromDeviceId: att.deviceId   ?? '',
          isFinal,
        })
        if (!isFinal) {
          this._broadcast({ type: 'participants', list: this._getParticipants() })
        }
        break
      }

      case 'undone': {
        const att = ws.deserializeAttachment() ?? {}
        ws.serializeAttachment({ ...att, isDone: false })
        this._broadcast({ type: 'participants', list: this._getParticipants() })
        // undone は participants ブロードキャストで全員の状態が反映されるため追加メッセージ不要
        break
      }

      case 'message': {
        const text = String(msg.text ?? '').trim().slice(0, MAX_CHAT_TEXT_LEN)
        if (!text) return
        const att = ws.deserializeAttachment() ?? {}

        const replyTo = msg.replyTo ? {
          id:         String(msg.replyTo.id         ?? '').slice(0, MAX_UNIT_LEN),
          text:       String(msg.replyTo.text       ?? '').slice(0, 100),
          senderName: String(msg.replyTo.senderName ?? '').slice(0, MAX_DEVICE_NAME_LEN),
        } : null

        const msgObj = {
          id:        `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          senderName: att.deviceName ?? '名前未設定',
          senderId:   att.deviceId   ?? '',
          timestamp:  Date.now(),
          replyTo,
        }

        const messages = (await this.state.storage.get('messages')) ?? []
        messages.push(msgObj)
        if (messages.length > MAX_AUDIT_LOG) messages.splice(0, messages.length - MAX_AUDIT_LOG)
        await this.state.storage.put('messages', messages)

        this._broadcast({ type: 'message', ...msgObj })
        break
      }

      case 'message_delete': {
        const id = String(msg.id ?? '')
        if (!id) return
        const att = ws.deserializeAttachment() ?? {}
        const messages = (await this.state.storage.get('messages')) ?? []
        const idx = messages.findIndex(m => m.id === id)
        if (idx < 0) return
        // 自分が送ったメッセージのみ取り消し可
        if (messages[idx].senderId !== (att.deviceId ?? '')) return
        messages.splice(idx, 1)
        await this.state.storage.put('messages', messages)
        this._broadcast({ type: 'message_deleted', id })
        break
      }

      case 'dissolve': {
        if (!this._isHost(ws)) return
        this._broadcast({ type: 'dissolved' }, ws)
        await this.state.storage.deleteAll()
        for (const w of this.state.getWebSockets()) {
          try { w.close(1000, 'Room dissolved') } catch (_) {}
        }
        break
      }

      case 'rename': {
        const newName = String(msg.deviceName ?? '').slice(0, MAX_DEVICE_NAME_LEN)
        if (newName) {
          const existingNames = new Set(
            this.state.getWebSockets()
              .filter(w => w !== ws)
              .map(w => w.deserializeAttachment()?.deviceName)
              .filter(Boolean)
          )
          if (existingNames.has(newName)) {
            ws.send(JSON.stringify({ type: 'error', code: 'name_taken', context: 'rename' }))
            return
          }
        }
        const att = ws.deserializeAttachment() ?? {}
        ws.serializeAttachment({ ...att, deviceName: newName })
        this._broadcast({ type: 'participants', list: this._getParticipants() })
        break
      }

      // ── セッション管理 ────────────────────────────────────────────────────
      case 'session_start': {
        if (!this._isHost(ws)) return
        const newId  = String(msg.sessionId ?? '').slice(0, MAX_TOKEN_LEN)
        const prevId = (await this.state.storage.get('sessionId')) ?? ''
        const isResume = !!(newId && newId === prevId)

        const puts = [
          this.state.storage.put('isActive',  true),
          this.state.storage.put('sessionId', newId),
        ]

        let broadcastInv    = {}
        let broadcastOrders = {}
        let broadcastFlags  = {}
        let broadcastCfg    = null

        if (!isResume) {
          // 新規セッション: 全員の完了フラグをリセット
          for (const existingWs of this.state.getWebSockets()) {
            const a = existingWs.deserializeAttachment()
            if (a?.isDone) existingWs.serializeAttachment({ ...a, isDone: false })
          }
          // ホストが送った在庫・フラグ・品目リストを原子的に保存
          const now = Date.now()
          if (msg.inventory && typeof msg.inventory === 'object') {
            for (const [k, v] of Object.entries(msg.inventory)) {
              if (typeof v?.qty === 'number' && String(k).length <= 200) {
                broadcastInv[k] = {
                  qty:       v.qty,
                  unit:      String(v.unit      ?? '').slice(0, MAX_UNIT_LEN),
                  enteredBy: String(v.enteredBy ?? '').slice(0, MAX_DEVICE_NAME_LEN),
                  updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : now,
                }
              }
            }
          }
          puts.push(this.state.storage.put('inventory', broadcastInv))
          puts.push(this.state.storage.put('auditLog',  []))

          // 発注数（発注ルームのみ送られてくる。棚卸は undefined → 空のまま）
          if (msg.orders && typeof msg.orders === 'object') {
            for (const [k, v] of Object.entries(msg.orders)) {
              if (Number.isFinite(v?.orderQty) && v.orderQty > 0 && v.orderQty <= MAX_ORDER_QTY && String(k).length <= 200) {
                broadcastOrders[k] = {
                  orderQty:    v.orderQty,
                  unit:        String(v.unit ?? '').slice(0, MAX_UNIT_LEN),
                  lot:         Number.isFinite(Number(v.lot)) && Number(v.lot) > 0 ? Number(v.lot) : 1,
                  enteredBy:   String(v.enteredBy ?? '').slice(0, MAX_DEVICE_NAME_LEN),
                  enteredById: String(v.enteredById ?? '').slice(0, MAX_DEVICE_ID_LEN),
                  updatedAt:   typeof v.updatedAt === 'number' ? v.updatedAt : now,
                }
              }
            }
          }
          puts.push(this.state.storage.put('orders', broadcastOrders))

          if (msg.recountFlags && typeof msg.recountFlags === 'object') {
            for (const [k, v] of Object.entries(msg.recountFlags)) {
              if (String(k).length <= 200) {
                broadcastFlags[k] = {
                  by: String(v?.by ?? '').slice(0, MAX_DEVICE_NAME_LEN),
                  at: typeof v?.at === 'number' ? v.at : now,
                }
              }
            }
          }
          puts.push(this.state.storage.put('recountFlags', broadcastFlags))

          const c = msg.config
          if (c && Array.isArray(c.order) && c.order.length > 0) {
            broadcastCfg = normalizeConfig(c)   // 軸・非表示等を含む全フィールド
            puts.push(this.state.storage.put('config', broadcastCfg))
          }
        } else {
          // 再開セッション: 既存の在庫・発注数・フラグ・品目リストをブロードキャスト用に読み込む
          ;[broadcastInv, broadcastOrders, broadcastFlags, broadcastCfg] = await Promise.all([
            this.state.storage.get('inventory').then(v => v ?? {}),
            this.state.storage.get('orders').then(v => v ?? {}),
            this.state.storage.get('recountFlags').then(v => v ?? {}),
            this.state.storage.get('config').then(v => v ?? null),
          ])
        }

        await Promise.all(puts)
        // session_started に在庫・発注数・フラグ・品目リストを同梱する
        // → 既接続ゲストが新セッション開始時に完全な状態へ同期できる（ゲストには prices を落とす・S-G）
        this._broadcastPriceAware({
          type:         'session_started',
          sessionId:    newId,
          inventory:    broadcastInv,
          orders:       broadcastOrders,
          recountFlags: broadcastFlags,
          ...(broadcastCfg ? { config: broadcastCfg } : {}),
        })
        break
      }

      case 'session_end': {
        if (!this._isHost(ws)) return
        const status    = msg.status === 'completed' ? 'completed' : 'incomplete'
        const sessionId = (await this.state.storage.get('sessionId')) ?? ''
        const inventory = (await this.state.storage.get('inventory')) ?? {}
        const itemCount = Object.keys(inventory).length
        await this.state.storage.put('isActive', false)
        this._broadcast({ type: 'session_ended', status, sessionId, itemCount })
        break
      }

      case 'typing': {
        // 入力中インジケータ: 送信者以外の全員へ転送（deviceId/deviceName を付与）
        const att = ws.deserializeAttachment() ?? {}
        this._broadcast({
          type:       'typing',
          ingredient: String(msg.ingredient ?? '').slice(0, MAX_INGREDIENT_LEN),
          active:     !!msg.active,
          deviceId:   att.deviceId   ?? '',
          deviceName: att.deviceName ?? '',
        }, ws)
        break
      }

      case 'conflict_notify': {
        // 同時入力競合の発生をルーム全員（主にホスト）へ通知
        const att = ws.deserializeAttachment() ?? {}
        this._broadcast({
          type:        'conflict_notify',
          ingredient:  String(msg.ingredient ?? '').slice(0, MAX_INGREDIENT_LEN),
          fromName:    String(msg.fromName   ?? att.deviceName ?? '').slice(0, MAX_DEVICE_NAME_LEN),
          guestQty:    msg.guestQty,
          guestUnit:   msg.guestUnit  != null ? String(msg.guestUnit).slice(0, 20)  : undefined,
          hostQty:     msg.hostQty,
          hostUnit:    msg.hostUnit   != null ? String(msg.hostUnit).slice(0, 20)   : undefined,
        }, ws)
        break
      }

      case 'conflict_lock': {
        // 競合中品目リストをゲストへ転送（ホスト→全員）
        if (!this._isHost(ws)) return
        this._broadcast({
          type:        'conflict_lock',
          ingredients: (msg.ingredients ?? []).map(s => String(s).slice(0, MAX_INGREDIENT_LEN)),
        }, ws)
        break
      }

      case 'item_add_request': {
        const att  = ws.deserializeAttachment() ?? {}
        const name = String(msg.name ?? '').trim().slice(0, MAX_INGREDIENT_LEN)
        const requestId = String(msg.requestId ?? '').slice(0, 64)
        if (!name || !requestId) return

        this._itemAddRequests.set(requestId, ws)

        const hostWs = this.state.getWebSockets().find(w => w.deserializeAttachment()?.isHost)
        if (!hostWs) {
          ws.send(JSON.stringify({ type: 'item_add_response', requestId, approved: false, reason: 'host_offline', name }))
          this._itemAddRequests.delete(requestId)
          return
        }
        hostWs.send(JSON.stringify({
          type:           'item_add_request',
          requestId,
          name,
          unit:           String(msg.unit ?? '').slice(0, MAX_UNIT_LEN),
          code:           String(msg.code ?? '').slice(0, 64),
          fromDeviceId:   att.deviceId   ?? '',
          fromDeviceName: att.deviceName ?? '',
        }))
        break
      }

      case 'item_add_response': {
        if (!this._isHost(ws)) return
        const requestId   = String(msg.requestId ?? '').slice(0, 64)
        const requesterWs = this._itemAddRequests.get(requestId)
        this._itemAddRequests.delete(requestId)
        if (requesterWs) {
          try {
            requesterWs.send(JSON.stringify({
              type:     'item_add_response',
              requestId,
              approved: !!msg.approved,
              name:     String(msg.name ?? '').slice(0, MAX_INGREDIENT_LEN),
            }))
          } catch (_) {}
        }
        break
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  async webSocketClose(ws) {
    // 'leave' メッセージで既にブロードキャスト済みの場合は二重送信しない
    const attachment = ws.deserializeAttachment()
    if (attachment?.joined === true && !attachment.leftCleanly) {
      this._broadcast({ type: 'participants', list: this._getParticipants() })
    }
  }

  async alarm() {
    for (const ws of this.state.getWebSockets()) {
      try { ws.close(1001, 'Room expired') } catch (_) {}
    }
    await this.state.storage.deleteAll()
  }

  _broadcast(msg, exclude = null) {
    const data = JSON.stringify(msg)
    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude && this._isJoined(ws)) {
        try { ws.send(data) } catch (_) {}
      }
    }
  }

  // ゲストには単価（原価）を渡さない（S-G）。config_update はトップレベル prices、
  // joined/session_started は config.prices に入るため、両方を空にしたコピーを返す。
  _stripPricesForGuest(msg) {
    const out = { ...msg }
    if (out.prices) out.prices = {}
    if (out.config && out.config.prices) out.config = { ...out.config, prices: {} }
    return out
  }

  // 単価を含みうるメッセージのブロードキャスト。ホストには全量、ゲストには prices を落として送る。
  _broadcastPriceAware(msg, exclude = null) {
    const full  = JSON.stringify(msg)
    const guest = JSON.stringify(this._stripPricesForGuest(msg))
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude || !this._isJoined(ws)) continue
      const isHost = this._isHost(ws)
      try { ws.send(isHost ? full : guest) } catch (_) {}
    }
  }

  _isJoined(ws) {
    const attachment = ws.deserializeAttachment()
    return attachment?.joined === true
      && typeof attachment.deviceId === 'string'
      && attachment.deviceId.length > 0
  }

  _isHost(ws) {
    return this._isJoined(ws) && ws.deserializeAttachment()?.isHost === true
  }

  // PIN設定済み（＝D1認証で保護すべき）店舗か。明示的に存在しPIN未設定と確認できた
  // 店舗だけfalse（レガシー）にする。不明・DB未設定・D1障害は保護対象として扱い、
  // 続くauth token検証も成功しない限り新規host tokenを発行しない。
  async _isStoreProtected(shopCode) {
    if (!shopCode || !this.env?.DB) return true
    try {
      const row = await this.env.DB.prepare('SELECT pin_hash FROM stores WHERE shop_code = ?').bind(shopCode).first()
      return !row || !!row.pin_hash
    } catch (e) {
      console.error('[RoomDO] store protection lookup failed (fail-closed):', e?.message ?? e)
      return true
    }
  }

  // join メッセージの認証トークンが、この店舗の有効な D1 トークンか。
  async _hostAuthOk(shopCode, rawToken) {
    if (!shopCode || !this.env?.DB) return false
    try {
      const token = String(rawToken ?? '').slice(0, MAX_TOKEN_LEN)
      const tokenStore = await verifyAuthToken(this.env.DB, token)
      return !!tokenStore && tokenStore === shopCode
    } catch (e) {
      console.error('[RoomDO] host auth check failed:', e?.message ?? e)
      return false
    }
  }

  // 監査ログエントリを生成して追記・上限で切り詰める（id/timestamp は fields で上書き可）
  _appendAudit(auditLog, fields) {
    const entry = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: Date.now(),
      ...fields,
    }
    auditLog.push(entry)
    if (auditLog.length > MAX_AUDIT_LOG) auditLog.splice(0, auditLog.length - MAX_AUDIT_LOG)
    return entry
  }

  _getParticipants() {
    return this.state.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(a => a?.joined === true && typeof a.deviceId === 'string' && a.deviceId.length > 0)
      .map(a => ({
        deviceId:   a.deviceId,
        deviceName: a.deviceName ?? '',
        isHost:     a.isHost === true,
        isDone:     a.isDone === true,
      }))
  }
}
