<script setup>
/**
 * 記録の確認（管理タブ）。この店舗のサーバー（D1）にある記録と、この端末に残っている記録を
 * そのまま並べる。「完了したはずの棚卸が履歴に無い」とき（User報告 2026-09-30）に、
 * どこまで届いているかをその場で見るための画面。表示だけで、何も書き換えない。
 * 「まとめてコピー」で中身をそのまま貼り付けて共有できる（トークンなどの認証情報は含めない）。
 */
import { ref, computed, onMounted } from 'vue'
import { getSessions } from '../composables/useAuth.js'
import { shopCode, loadHistoryFromD1, loadOrdersFromD1, loadMovementsFromD1, unpersistedCount, rejectedSaves } from '../composables/useStore.js'
import { useHistory } from '../composables/useHistory.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))
const { getSnapshots } = useHistory()

const loading = ref(true)
const err = ref({})
const server = ref({ sessions: null, history: null, orders: null, movements: null })
const copied = ref(false)

function _readLocal(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch (_) { return null }
}
const local = computed(() => ({
  pendingSession:   _readLocal(STORAGE_KEYS.pendingSession),
  completionIntent: (() => { const v = _readLocal(STORAGE_KEYS.completionIntent); return v ? { sessionId: v.sessionId ?? v.request?.sessionId ?? null, type: v.type ?? v.request?.type ?? null, savedAt: v.savedAt ?? null } : null })(),
  snapshots: getSnapshots().map(s => ({ date: s.date, sessionId: s.sessionId ?? null, items: Object.keys(s.items ?? s.inventory ?? {}).length, savedAt: s.savedAt ?? null, synced: s.synced ?? null, source: s.source ?? null })),
  unsent: unpersistedCount.value,
  rejected: rejectedSaves.value.map(r => ({ kind: r.label, status: r.status, message: r.message, at: new Date(r.at).toLocaleString('ja-JP') })),
}))

async function _get(name, fn) {
  try { server.value[name] = await fn() ?? [] } catch (e) { err.value[name] = e?.message || String(e) }
}
async function load() {
  loading.value = true
  err.value = {}
  await Promise.all([
    _get('sessions',  () => getSessions()),
    _get('history',   () => loadHistoryFromD1()),
    _get('orders',    () => loadOrdersFromD1(1000)),
    _get('movements', () => loadMovementsFromD1(1000)),
  ])
  loading.value = false
}
onMounted(load)

const fmt = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? (iso || '—') : d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const sessions = computed(() => [...(server.value.sessions || [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))))
const history  = computed(() => {
  const h = server.value.history
  const list = Array.isArray(h) ? h : (Array.isArray(h?.history) ? h.history : Array.isArray(h?.snapshots) ? h.snapshots : [])
  return [...list].sort((a, b) => String(b.date ?? b.savedAt).localeCompare(String(a.date ?? a.savedAt)))
})

async function copyAll() {
  const text = JSON.stringify({
    shopCode: shopCode.value, at: new Date().toISOString(),
    server: {
      sessions: sessions.value.map(s => ({ id: s.id, type: s.type, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, itemCount: s.itemCount, importBatchId: s.importBatchId ?? null })),
      history: history.value.map(h => ({ date: h.date, sessionId: h.sessionId ?? null, itemCount: h.itemCount ?? Object.keys(h.items ?? {}).length, savedAt: h.savedAt ?? null })),
      orders: (server.value.orders || []).map(o => ({ id: o.id, date: o.date, lines: o.lines?.length ?? 0 })),
      movements: (server.value.movements || []).map(m => ({ id: m.id, date: m.date, type: m.type, lines: m.lines?.length ?? 0 })),
      errors: err.value,
    },
    local: local.value,
  }, null, 1)
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => { copied.value = false }, 2000) } catch (_) { window.prompt('コピーしてください', text) }
}
</script>

<template>
  <div class="di-bg">
    <div class="di" role="dialog" aria-modal="true" aria-label="記録の確認">
      <header class="di-head">
        <button class="di-back" type="button" @click="emit('close')">‹ 閉じる</button>
        <span class="di-title">🔎 記録の確認</span>
        <button class="di-copy" type="button" @click="copyAll">{{ copied ? '✓ コピーしました' : 'まとめてコピー' }}</button>
      </header>
      <div class="di-body">
        <p class="di-note">店舗 <b>{{ shopCode || '—' }}</b> のサーバーにある記録と、この端末に残っている記録です。表示するだけで、何も変更しません。</p>
        <div v-if="loading" class="di-loading">サーバーから読み込み中…</div>

        <h3>サーバー：セッション（棚卸・発注） <small>{{ sessions.length }}件</small></h3>
        <div v-if="err.sessions" class="di-err">読めませんでした：{{ err.sessions }}</div>
        <table v-else class="di-t">
          <tr><th>種類</th><th>状態</th><th>開始</th><th>終了</th><th>品目</th></tr>
          <tr v-for="s in sessions" :key="s.id" :class="{ open: s.status !== 'completed' }">
            <td>{{ s.type === 'order' ? '発注' : s.importBatchId ? '取込' : '棚卸' }}</td>
            <td>{{ s.status === 'completed' ? '完了' : '進行中' }}</td>
            <td>{{ fmt(s.startedAt) }}</td>
            <td>{{ s.endedAt ? fmt(s.endedAt) : '—' }}</td>
            <td>{{ s.itemCount ?? '—' }}</td>
          </tr>
        </table>

        <h3>サーバー：棚卸の記録（履歴の中身） <small>{{ history.length }}件</small></h3>
        <div v-if="err.history" class="di-err">読めませんでした：{{ err.history }}</div>
        <table v-else class="di-t">
          <tr><th>日付</th><th>品目</th><th>保存</th><th>セッション</th></tr>
          <tr v-for="(h, i) in history" :key="h.sessionId || h.date || i">
            <td>{{ h.date }}</td>
            <td>{{ h.itemCount ?? Object.keys(h.items ?? {}).length }}</td>
            <td>{{ h.savedAt ? fmt(h.savedAt) : '—' }}</td>
            <td class="di-id">{{ (h.sessionId || '').slice(0, 8) || '—' }}</td>
          </tr>
        </table>

        <h3>サーバー：発注 <small>{{ (server.orders || []).length }}件</small> ・ 入出庫 <small>{{ (server.movements || []).length }}件</small></h3>
        <div v-if="err.orders || err.movements" class="di-err">読めませんでした：{{ err.orders || err.movements }}</div>

        <h3>この端末</h3>
        <table class="di-t">
          <tr><th>進行中のセッション</th><td>{{ local.pendingSession ? `${local.pendingSession.type === 'order' ? '発注' : '棚卸'} ${fmt(local.pendingSession.startedAt)} 開始（${local.pendingSession.status || '進行中'}）` : 'なし' }}</td></tr>
          <tr><th>送信中の完了</th><td>{{ local.completionIntent ? `あり（${local.completionIntent.type || ''}・結果が確認できていない）` : 'なし' }}</td></tr>
          <tr><th>未送信の保存</th><td>{{ local.unsent }}件</td></tr>
          <tr><th>サーバーに断られた保存</th><td>{{ local.rejected.length ? local.rejected.map(r => `${r.kind}（${r.status ?? ''} ${r.message}）`).join(' / ') : 'なし' }}</td></tr>
        </table>
        <h3>この端末：棚卸の記録 <small>{{ local.snapshots.length }}件</small></h3>
        <table class="di-t">
          <tr><th>日付</th><th>品目</th><th>送信</th><th>セッション</th></tr>
          <tr v-for="(s, i) in local.snapshots" :key="s.sessionId || s.date || i">
            <td>{{ s.date }}{{ s.source === 'import' ? '（取込）' : '' }}</td>
            <td>{{ s.items }}</td>
            <td>{{ s.synced === true ? '済' : s.synced === false ? '未' : '—' }}</td>
            <td class="di-id">{{ (s.sessionId || '').slice(0, 8) || '—' }}</td>
          </tr>
        </table>
        <button class="di-reload" type="button" @click="load">↻ 読み込み直す</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.di-bg { position: fixed; inset: 0; z-index: 60; background: #edf5f7; display: flex; justify-content: center; }
.di { width: 100%; max-width: 640px; display: flex; flex-direction: column; height: 100dvh; }
.di-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #fff; border-bottom: 1px solid #d6e6ea; }
.di-back { border: none; background: none; color: var(--primary, #0e7490); font-weight: 700; font-size: 14px; cursor: pointer; }
.di-title { font-weight: 800; font-size: 16px; flex: 1; }
.di-copy { border: 1.5px solid #67e8f9; background: #ecfeff; color: #155e75; border-radius: 9px; padding: 6px 10px; font-weight: 800; font-size: 12.5px; cursor: pointer; }
.di-body { flex: 1; overflow-y: auto; padding: 12px 14px 40px; }
.di-note { font-size: 12.5px; color: #3d5a62; line-height: 1.6; margin: 0 0 8px; }
.di-loading { font-size: 13px; color: #4c6a72; margin: 8px 0; }
h3 { font-size: 14px; margin: 16px 0 6px; color: #12303a; }
h3 small { font-weight: 700; color: #4c6a72; }
.di-err { font-size: 12.5px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 6px 9px; }
.di-t { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; font-size: 12px; }
.di-t th, .di-t td { border-bottom: 1px solid #edf5f7; padding: 6px 8px; text-align: left; vertical-align: top; }
.di-t th { background: #f6fafb; color: #4c6a72; font-weight: 700; white-space: nowrap; }
.di-t tr.open td { background: #fff7ed; }
.di-id { font-family: monospace; color: #7d969c; }
.di-reload { margin: 16px auto 0; display: block; border: 1.5px solid #bfd6dc; background: #fff; border-radius: 10px; padding: 9px 16px; font-weight: 800; cursor: pointer; }
</style>
