/**
 * Durable Object の state / storage の最小モック。
 *
 * 監査ログをチャンク分割（`audit:000000`…）したことで、RoomDO は
 * `list({ prefix, reverse, limit })` と `delete(keys[])`、`put(object)` を使う。
 * 実 DO の挙動に合わせて **キーの昇順**で返す。
 */
export function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    _store: store,
    async get(k) {
      if (Array.isArray(k)) return new Map(k.filter(key => store.has(key)).map(key => [key, store.get(key)]))
      return store.get(k)
    },
    async put(k, v) {
      if (typeof k === 'object' && k !== null) {
        for (const [key, value] of Object.entries(k)) store.set(key, value)
        return
      }
      store.set(k, v)
    },
    async delete(k) {
      const keys = Array.isArray(k) ? k : [k]
      let n = 0
      for (const key of keys) if (store.delete(key)) n++
      return n
    },
    async list({ prefix = '', reverse = false, limit = Infinity } = {}) {
      let keys = [...store.keys()].filter(k => k.startsWith(prefix)).sort()
      if (reverse) keys.reverse()
      if (Number.isFinite(limit)) keys = keys.slice(0, limit)
      return new Map(keys.map(k => [k, store.get(k)]))
    },
    async setAlarm() {},
    async getAlarm() { return null },
  }
}

export function makeState(wsList = [], initial = {}) {
  const storage = makeStorage(initial)
  return {
    storage,
    getWebSockets() { return wsList },
    _store: storage._store,
  }
}
