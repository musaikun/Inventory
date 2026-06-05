/**
 * RoomDO — Cloudflare Durable Object（WebSocketルーム管理）
 */
export class RoomDO {
  constructor(state, env) {
    this.state = state
    this.env   = env
  }

  async fetch(request) {
    const url = new URL(request.url)
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
    if (!alarm) await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)
    return new Response(null, { status: 101, webSocket: client })
  }

  async _handleHttpDissolve(request) {
    const json = (body, status) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    let body = {}
    try { body = await request.json() } catch (_) {}

    const storedToken = await this.state.storage.get('hostToken')
    // ルームが存在しない（既に解散済み）: 成功扱い
    if (!storedToken) return json({ ok: true, alreadyGone: true }, 200)

    const providedToken = String(body.hostToken ?? '').slice(0, 64)
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
    const [inventory, isActive, sessionId] = await Promise.all([
      this.state.storage.get('inventory').then(v => v ?? {}),
      this.state.storage.get('isActive').then(v => v ?? false),
      this.state.storage.get('sessionId').then(v => v ?? ''),
    ])
    return new Response(JSON.stringify({
      sessionId,
      isActive,
      itemCount: Object.keys(inventory).length,
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
    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)

    // レート制限: ping/join 以外は 2秒ウィンドウで最大 20件
    if (msg.type !== 'ping' && msg.type !== 'join') {
      const att   = ws.deserializeAttachment() ?? {}
      const now   = Date.now()
      const start = att._rlTime ?? 0
      const count = att._rlCount ?? 0
      if (now - start <= 2000) {
        if (count >= 20) return
        ws.serializeAttachment({ ...att, _rlCount: count + 1 })
      } else {
        ws.serializeAttachment({ ...att, _rlTime: now, _rlCount: 1 })
      }
    }

    switch (msg.type) {
      case 'join': {
        const deviceId   = String(msg.deviceId   ?? '').slice(0, 64)
        const deviceName = String(msg.deviceName ?? '').slice(0, 30)
        const role       = msg.role === 'host' ? 'host' : 'guest'

        let isVerifiedHost = false
        let newHostToken   = null   // 初回発行時のみ送り返す

        if (role === 'host') {
          const storedToken   = await this.state.storage.get('hostToken')
          const providedToken = String(msg.hostToken ?? '').slice(0, 64)

          if (!storedToken) {
            // 初回ホスト接続: トークンを発行して保存
            const token = crypto.randomUUID()
            await this.state.storage.put('hostToken', token)
            isVerifiedHost = true
            newHostToken   = token
          } else if (providedToken === storedToken) {
            // 再接続: トークン一致 → ホスト承認
            isVerifiedHost = true
          } else {
            // トークン不一致: 以下のいずれかを満たせばトークンを再発行して復旧する
            //   ① 他に接続が無い（空ルーム再初期化）
            //   ② 同一 deviceId のホスト接続が残存（オフライン復帰でトークンを失った本人）
            //   ③ 他にホスト権限を持つ接続が一つも無い（ホスト不在のルームの引き継ぎ）
            // ②③により、同時オフライン→復帰時の auth_failed 無限ループを解消する。
            const others = this.state.getWebSockets().filter(w => w !== ws)
            const sameDeviceHost  = others.some(w => {
              const a = w.deserializeAttachment()
              return a?.deviceId === deviceId && a?.isHost
            })
            const anyVerifiedHost = others.some(w => w.deserializeAttachment()?.isHost)
            if (others.length === 0 || sameDeviceHost || !anyVerifiedHost) {
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
        }

        // 参加者上限チェック（同じ deviceId のセッション復帰は除外）
        const MAX_PARTICIPANTS = 20
        const existingIds = new Set(
          this.state.getWebSockets()
            .filter(w => w !== ws)
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
              .filter(w => w !== ws)
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
        for (const existingWs of this.state.getWebSockets()) {
          if (existingWs === ws) continue
          const att = existingWs.deserializeAttachment()
          if (att?.deviceId === deviceId) {
            try { existingWs.close(1000, 'Session recovered') } catch (_) {}
          }
        }

        ws.serializeAttachment({ deviceId, deviceName, isHost: isVerifiedHost })

        const [inventory, recountFlags, config, messages, auditLog, isActive, sessionId] = await Promise.all([
          this.state.storage.get('inventory').then(v => v ?? {}),
          this.state.storage.get('recountFlags').then(v => v ?? {}),
          this.state.storage.get('config').then(v => v ?? null),
          this.state.storage.get('messages').then(v => v ?? []),
          this.state.storage.get('auditLog').then(v => v ?? []),
          this.state.storage.get('isActive').then(v => v ?? false),
          this.state.storage.get('sessionId').then(v => v ?? ''),
        ])
        const participants = this._getParticipants()

        ws.send(JSON.stringify({
          type: 'joined', inventory, recountFlags, config, participants, messages, auditLog,
          isSessionActive: isActive, sessionId,
          ...(newHostToken ? { hostToken: newHostToken } : {}),
        }))
        this._broadcast({ type: 'participants', list: this._getParticipants() }, ws)
        break
      }

      case 'config': {
        if (!this._isHost(ws)) return
        const { order, units, prices, categories, codes, categoryCodes,
                prevMonths, lotSizes, dictionary, isCustom } = msg
        if (!Array.isArray(order)) return
        const stored = {
          order, isCustom: !!isCustom,
          units: units ?? {}, prices: prices ?? {}, categories: categories ?? {},
          codes: codes ?? {}, categoryCodes: categoryCodes ?? {},
          prevMonths: prevMonths ?? {}, lotSizes: lotSizes ?? {}, dictionary: dictionary ?? {},
        }
        await this.state.storage.put('config', stored)
        // ゲスト全員に品目リスト更新を通知
        this._broadcast({ type: 'config_update', ...stored }, ws)
        break
      }

      case 'update': {
        const { ingredient, qty, unit, enteredBy, isAdd } = msg
        if (!ingredient || typeof qty !== 'number') return
        if (String(ingredient).length > 200) return

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
          enteredBy: String(enteredBy ?? '').slice(0, 30),
          updatedAt: Date.now(),
        }

        const att = ws.deserializeAttachment() ?? {}
        const entry = {
          id:          `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          ingredient,
          action,
          delta,
          totalQty:    qty,
          unit:        unit ?? '',
          enteredBy:   String(enteredBy ?? '').slice(0, 30),
          enteredById: att.deviceId ?? '',
          timestamp:   Date.now(),
        }
        auditLog.push(entry)
        if (auditLog.length > 200) auditLog.splice(0, auditLog.length - 200)

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
        if (!ingredient || String(ingredient).length > 200) return

        const [inventory, auditLog] = await Promise.all([
          this.state.storage.get('inventory').then(v => v ?? {}),
          this.state.storage.get('auditLog').then(v => v ?? []),
        ])

        const prev = inventory[ingredient]
        if (prev) {
          const att = ws.deserializeAttachment() ?? {}
          const entry = {
            id:          `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            ingredient,
            action:      'remove',
            delta:       -(prev.qty ?? 0),
            totalQty:    0,
            unit:        prev.unit ?? '',
            enteredBy:   att.deviceName ?? '',
            enteredById: att.deviceId  ?? '',
            timestamp:   Date.now(),
          }
          auditLog.push(entry)
          if (auditLog.length > 200) auditLog.splice(0, auditLog.length - 200)
          this._broadcast({ type: 'audit_entry', entry })
          await this.state.storage.put('auditLog', auditLog)
        }

        delete inventory[ingredient]
        await this.state.storage.put('inventory', inventory)

        const { deviceId } = ws.deserializeAttachment() ?? {}
        this._broadcast({ type: 'remove', ingredient, fromDeviceId: deviceId }, ws)
        break
      }

      case 'scope': {
        const scope = msg.scope === 'food' || msg.scope === 'supply' ? msg.scope : 'all'
        this._broadcast({ type: 'scope', scope }, ws)
        break
      }

      case 'recount_flag': {
        const ingredient = String(msg.ingredient ?? '')
        if (!ingredient || ingredient.length > 200) return
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
        if (on) flags[ingredient] = { by: String(att.deviceName ?? '').slice(0, 30), at }
        else    delete flags[ingredient]

        const inventory = (await this.state.storage.get('inventory')) ?? {}
        const cur       = inventory[ingredient]
        const auditLog  = (await this.state.storage.get('auditLog')) ?? []
        const entry = {
          id:          `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          ingredient,
          action:      on ? 'flag_recount' : 'unflag_recount',
          delta:       0,
          totalQty:    cur?.qty ?? 0,
          unit:        cur?.unit ?? '',
          enteredBy:   String(att.deviceName ?? '').slice(0, 30),
          enteredById: att.deviceId ?? '',
          timestamp:   at,
        }
        auditLog.push(entry)
        if (auditLog.length > 200) auditLog.splice(0, auditLog.length - 200)

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
        const att = ws.deserializeAttachment() ?? {}
        ws.serializeAttachment({ ...att, leftCleanly: true })
        // 退出を即時通知: TCP クローズ検出を待たず参加者リストを更新してブロードキャスト
        const remaining = this.state.getWebSockets()
          .filter(w => w !== ws)
          .map(w => w.deserializeAttachment())
          .filter(Boolean)
        this._broadcast({ type: 'participants', list: remaining }, ws)
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
        const text = String(msg.text ?? '').trim().slice(0, 500)
        if (!text) return
        const att = ws.deserializeAttachment() ?? {}

        const replyTo = msg.replyTo ? {
          id:         String(msg.replyTo.id         ?? '').slice(0, 50),
          text:       String(msg.replyTo.text       ?? '').slice(0, 100),
          senderName: String(msg.replyTo.senderName ?? '').slice(0, 30),
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
        if (messages.length > 200) messages.splice(0, messages.length - 200)
        await this.state.storage.put('messages', messages)

        this._broadcast({ type: 'message', ...msgObj })
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
        const newName = String(msg.deviceName ?? '').slice(0, 30)
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
        const newId  = String(msg.sessionId ?? '').slice(0, 64)
        const prevId = (await this.state.storage.get('sessionId')) ?? ''
        const isResume = !!(newId && newId === prevId)

        const puts = [
          this.state.storage.put('isActive',  true),
          this.state.storage.put('sessionId', newId),
        ]

        let broadcastInv   = {}
        let broadcastFlags = {}
        let broadcastCfg   = null

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
                  unit:      String(v.unit      ?? '').slice(0, 50),
                  enteredBy: String(v.enteredBy ?? '').slice(0, 30),
                  updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : now,
                }
              }
            }
          }
          puts.push(this.state.storage.put('inventory', broadcastInv))
          puts.push(this.state.storage.put('auditLog',  []))

          if (msg.recountFlags && typeof msg.recountFlags === 'object') {
            for (const [k, v] of Object.entries(msg.recountFlags)) {
              if (String(k).length <= 200) {
                broadcastFlags[k] = {
                  by: String(v?.by ?? '').slice(0, 30),
                  at: typeof v?.at === 'number' ? v.at : now,
                }
              }
            }
          }
          puts.push(this.state.storage.put('recountFlags', broadcastFlags))

          const c = msg.config
          if (c && Array.isArray(c.order) && c.order.length > 0) {
            broadcastCfg = {
              order:         c.order,
              isCustom:      !!c.isCustom,
              units:         c.units         ?? {},
              prices:        c.prices        ?? {},
              categories:    c.categories    ?? {},
              codes:         c.codes         ?? {},
              categoryCodes: c.categoryCodes ?? {},
              prevMonths:    c.prevMonths    ?? {},
              lotSizes:      c.lotSizes      ?? {},
              dictionary:    c.dictionary    ?? {},
            }
            puts.push(this.state.storage.put('config', broadcastCfg))
          }
        } else {
          // 再開セッション: 既存の在庫・フラグ・品目リストをブロードキャスト用に読み込む
          ;[broadcastInv, broadcastFlags, broadcastCfg] = await Promise.all([
            this.state.storage.get('inventory').then(v => v ?? {}),
            this.state.storage.get('recountFlags').then(v => v ?? {}),
            this.state.storage.get('config').then(v => v ?? null),
          ])
        }

        await Promise.all(puts)
        // session_started に在庫・フラグ・品目リストを同梱する
        // → 既接続ゲストが新セッション開始時に完全な状態へ同期できる
        this._broadcast({
          type:         'session_started',
          sessionId:    newId,
          inventory:    broadcastInv,
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

      case 'conflict_notify': {
        // 同時入力競合の発生をルーム全員（主にホスト）へ通知
        const att = ws.deserializeAttachment() ?? {}
        this._broadcast({
          type:        'conflict_notify',
          ingredient:  String(msg.ingredient ?? '').slice(0, 200),
          fromName:    String(msg.fromName   ?? att.deviceName ?? '').slice(0, 30),
        }, ws)
        break
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  async webSocketClose(ws) {
    // 'leave' メッセージで既にブロードキャスト済みの場合は二重送信しない
    if (!ws.deserializeAttachment()?.leftCleanly) {
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
      if (ws !== exclude) {
        try { ws.send(data) } catch (_) {}
      }
    }
  }

  _isHost(ws) {
    return ws.deserializeAttachment()?.isHost === true
  }

  _getParticipants() {
    return this.state.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean)
  }
}
