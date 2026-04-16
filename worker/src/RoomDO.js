/**
 * RoomDO — Cloudflare Durable Object（WebSocketルーム管理）
 */
export class RoomDO {
  constructor(state, env) {
    this.state = state
    this.env   = env
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    this.state.acceptWebSocket(server)
    const alarm = await this.state.storage.getAlarm()
    if (!alarm) await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, message) {
    let msg
    try { msg = JSON.parse(message) } catch { return }
    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)

    switch (msg.type) {
      case 'join': {
        const deviceId   = String(msg.deviceId   ?? '').slice(0, 64)
        const deviceName = String(msg.deviceName ?? '').slice(0, 30)
        const role       = msg.role === 'host' ? 'host' : 'guest'

        // ゲストのみ: ルーム存在チェック
        if (role === 'guest') {
          const initialized = await this.state.storage.get('initialized')
          if (!initialized) {
            ws.send(JSON.stringify({ type: 'error', code: 'room_not_found' }))
            ws.close(1008, 'Room not found')
            return
          }
        } else {
          // ホスト: ルームを初期化済みとしてマーク
          await this.state.storage.put('initialized', true)
        }

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
          units: units ?? {}, prices: prices ?? {}, categories: categories ?? {},
          codes: codes ?? {}, categoryCodes: categoryCodes ?? {},
          prevMonths: prevMonths ?? {}, lotSizes: lotSizes ?? {}, dictionary: dictionary ?? {},
        })
        break
      }

      case 'update': {
        const { ingredient, qty, unit, enteredBy } = msg
        if (!ingredient || typeof qty !== 'number') return

        const inventory = (await this.state.storage.get('inventory')) ?? {}
        inventory[ingredient] = {
          qty,
          unit:      unit      ?? '',
          enteredBy: String(enteredBy ?? '').slice(0, 30),
        }
        await this.state.storage.put('inventory', inventory)

        const { deviceId } = ws.deserializeAttachment() ?? {}
        this._broadcast(
          { type: 'update', ingredient, qty, unit: unit ?? '', enteredBy: enteredBy ?? '', fromDeviceId: deviceId },
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
        // 全参加者へ（送信者含む）: 自端末でもシステムメッセージとして表示
        const att = ws.deserializeAttachment() ?? {}
        this._broadcast({
          type:         'done',
          deviceName:   att.deviceName ?? '名前未設定',
          fromDeviceId: att.deviceId   ?? '',
        })
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
        this._broadcast({ type: 'dissolved' }, ws)
        await this.state.storage.deleteAll()
        for (const w of this.state.getWebSockets()) {
          try { w.close(1000, 'Room dissolved') } catch (_) {}
        }
        break
      }

      case 'rename': {
        const newName = String(msg.deviceName ?? '').slice(0, 30)
        const att = ws.deserializeAttachment() ?? {}
        ws.serializeAttachment({ ...att, deviceName: newName })
        this._broadcast({ type: 'participants', list: this._getParticipants() })
        break
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  async webSocketClose(ws) {
    this._broadcast({ type: 'participants', list: this._getParticipants() })
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

  _getParticipants() {
    return this.state.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean)
  }
}
