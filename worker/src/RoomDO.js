/**
 * RoomDO — Cloudflare Durable Object（WebSocketルーム管理）
 *
 * 1ルーム = 1インスタンス。WebSocket Hibernation API を使用。
 * - セッションデータ（deviceId/deviceName）は WS attachment に保存
 * - 棚卸データは DO Storage に永続化（DO 再起動後も保持）
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
    // Hibernation API: DO はメッセージがない間スリープ可能
    this.state.acceptWebSocket(server)

    // 最初のアクティビティから24時間でルーム削除
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

    // アクティビティがあるたびにアラームを延長（24h）
    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)

    switch (msg.type) {
      case 'join': {
        const deviceId   = String(msg.deviceId   ?? '').slice(0, 64)
        const deviceName = String(msg.deviceName ?? '').slice(0, 30)

        // WS に deviceId/deviceName を紐付け（Hibernation 対応）
        ws.serializeAttachment({ deviceId, deviceName })

        // 現在の棚卸データを新参加者に送信
        const inventory    = (await this.state.storage.get('inventory')) ?? {}
        const participants = this._getParticipants()

        ws.send(JSON.stringify({ type: 'joined', inventory, participants }))

        // 他の参加者に参加通知
        this._broadcast({ type: 'participants', list: this._getParticipants() }, ws)
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
