/**
 * RoomDO — Cloudflare Durable Object（WebSocketルーム管理）
 *
 * 1ルーム = 1インスタンス。WebSocket Hibernation API を使用。
 * - セッションデータ（deviceId/deviceName）は WS attachment に保存
 * - 棚卸データ・チャット履歴・品目設定は DO Storage に永続化
 * - 最終アクティビティから24時間後に自動削除（Alarm API）
 */
export class RoomDO {
  constructor(state, env) {
    this.state = state
    this.env   = env
  }

  // ── WebSocket アップグレード ────────────────────────────────────────────────
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()
    this.state.acceptWebSocket(server)

    const alarm = await this.state.storage.getAlarm()
    if (!alarm) {
      await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── メッセージ受信（Hibernation lifecycle） ───────────────────────────────
  async webSocketMessage(ws, message) {
    let msg
    try { msg = JSON.parse(message) } catch { return }

    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)

    switch (msg.type) {
      case 'join': {
        const deviceId   = String(msg.deviceId   ?? '').slice(0, 64)
        const deviceName = String(msg.deviceName ?? '').slice(0, 30)

        // セッション復帰: 同じ deviceId の既存 WS を閉じる
        for (const existingWs of this.state.getWebSockets()) {
          if (existingWs === ws) continue
          const att = existingWs.deserializeAttachment()
          if (att?.deviceId === deviceId) {
            try { existingWs.close(1000, 'Session recovered') } catch (_) {}
          }
        }

        ws.serializeAttachment({ deviceId, deviceName })

        const [inventory, config, messages] = await Promise.all([
          this.state.storage.get('inventory').then(v => v ?? {}),
          this.state.storage.get('config').then(v => v ?? null),
          this.state.storage.get('messages').then(v => v ?? []),
        ])
        const participants = this._getParticipants()

        ws.send(JSON.stringify({ type: 'joined', inventory, config, participants, messages }))
        this._broadcast({ type: 'participants', list: this._getParticipants() }, ws)
        break
      }

      case 'config': {
        const { order, units, prices, categories, codes, categoryCodes,
                prevMonths, lotSizes, dictionary, isCustom } = msg
        if (!Array.isArray(order)) return
        await this.state.storage.put('config', {
          order, isCustom: !!isCustom,
          units:         units         ?? {},
          prices:        prices        ?? {},
          categories:    categories    ?? {},
          codes:         codes         ?? {},
          categoryCodes: categoryCodes ?? {},
          prevMonths:    prevMonths    ?? {},
          lotSizes:      lotSizes      ?? {},
          dictionary:    dictionary    ?? {},
        })
        break
      }

      case 'update': {
        const { ingredient, qty, unit } = msg
        if (!ingredient || typeof qty !== 'number') return

        const inventory = (await this.state.storage.get('inventory')) ?? {}
        inventory[ingredient] = { qty, unit: unit ?? '' }
        await this.state.storage.put('inventory', inventory)

        const { deviceId } = ws.deserializeAttachment() ?? {}
        this._broadcast(
          { type: 'update', ingredient, qty, unit: unit ?? '', fromDeviceId: deviceId },
          ws,
        )
        break
      }

      case 'remove': {
        const { ingredient } = msg
        if (!ingredient) return

        const inventory = (await this.state.storage.get('inventory')) ?? {}
        delete inventory[ingredient]
        await this.state.storage.put('inventory', inventory)

        const { deviceId } = ws.deserializeAttachment() ?? {}
        this._broadcast({ type: 'remove', ingredient, fromDeviceId: deviceId }, ws)
        break
      }

      case 'done': {
        const att = ws.deserializeAttachment() ?? {}
        this._broadcast(
          { type: 'done', deviceName: att.deviceName ?? '名前未設定' },
          ws,
        )
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

        // 履歴を永続化（最大200件）
        const messages = (await this.state.storage.get('messages')) ?? []
        messages.push(msgObj)
        if (messages.length > 200) messages.splice(0, messages.length - 200)
        await this.state.storage.put('messages', messages)

        // 全参加者へ（送信者含む）
        this._broadcast({ type: 'message', ...msgObj })
        break
      }

      case 'dissolve': {
        // ホストによるルーム解散: ゲストへ通知 → 全WS閉鎖 → ストレージ削除
        this._broadcast({ type: 'dissolved' }, ws)
        await this.state.storage.deleteAll()
        for (const w of this.state.getWebSockets()) {
          try { w.close(1000, 'Room dissolved') } catch (_) {}
        }
        break
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  // ── 切断（Hibernation lifecycle） ────────────────────────────────────────
  async webSocketClose(ws) {
    this._broadcast({ type: 'participants', list: this._getParticipants() })
  }

  // ── アラーム（24h 後にルーム削除） ────────────────────────────────────────
  async alarm() {
    for (const ws of this.state.getWebSockets()) {
      try { ws.close(1001, 'Room expired') } catch (_) {}
    }
    await this.state.storage.deleteAll()
  }

  // ── 内部ヘルパー ──────────────────────────────────────────────────────────
  _broadcast(msg, exclude = null) {
    const data = JSON.stringify(msg)
    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude) {
        try { ws.send(data) } catch (_) {}
      }
    }
  }

  _getParticipants() {
    return this.state.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean)
  }
}
