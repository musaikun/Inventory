<script setup>
/**
 * 書き出す（User決定 2026-10-17・モック docs/mocks/export-v2.html）。
 * 種類を選ぶ → その種類で最初に「いつ・何回分」と「形式（Excel / CSV）」、ほかは既定のままオン・オフ。
 * 中身は services/exportBuild.js、ファイルにするのは utils/exportFile.js。
 * 金額を見る権限（money）が無い人には、金額の切り替えを出さず、いつも金額なしで出す
 */
import { ref, computed, watch } from 'vue'
import { can } from '../composables/useAuth.js'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { runBusy } from '../composables/useBusy.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import {
  buildItemRows, buildStocktakeSheets, buildOrderRows, buildMovementRows, periodRange,
} from '../services/exportBuild.js'
import { downloadSheets } from '../utils/exportFile.js'

const emit = defineEmits(['close'])
const { config } = useConfig()
const { getSnapshots } = useHistory()
const { getOrders } = useOrders()
const { getMovements } = useMovements()

const kind = ref('')   // '' | 'items' | 'stock' | 'orders' | 'moves'
const TITLES = { items: '品目リスト', stock: '棚卸結果', orders: '発注の記録', moves: '入出庫の記録' }
const mayMoney = computed(() => can('money'))

// 共通: 形式（前に選んだものを既定に）・金額
const _fmt = () => { try { return localStorage.getItem(STORAGE_KEYS.exportFormat) === 'csv' ? 'csv' : 'xlsx' } catch (_) { return 'xlsx' } }
const format = ref(_fmt())
watch(format, v => { try { localStorage.setItem(STORAGE_KEYS.exportFormat, v) } catch (_) {} })
const money = ref(true)
const withMoney = computed(() => mayMoney.value && money.value)

// 品目リスト
const includeHidden = ref(false)
const hiddenCount = computed(() => (config.order ?? []).filter(n => (config.hiddenItems ?? []).includes(n)).length)
const itemTotal = computed(() => (config.order ?? []).length - (includeHidden.value ? 0 : hiddenCount.value))

// 棚卸結果
const snaps = computed(() => getSnapshots())
const snapKey = s => s.sessionId || `${s.date}|${s.savedAt ?? ''}`
const quick = ref('latest1')   // latest1 | latest3 | year | pick
const picked = ref(new Set())
const showAll = ref(false)
function setQuick(q) {
  quick.value = q
  const list = snaps.value
  const year = String(new Date().getFullYear())
  const chosen = q === 'latest1' ? list.slice(0, 1) : q === 'latest3' ? list.slice(0, 3)
    : q === 'year' ? list.filter(s => String(s.date).startsWith(year)) : [...picked.value].map(k => list.find(s => snapKey(s) === k)).filter(Boolean)
  picked.value = new Set(chosen.map(snapKey))
}
function toggleSnap(s) {
  const next = new Set(picked.value)
  const k = snapKey(s)
  if (next.has(k)) next.delete(k); else next.add(k)
  picked.value = next
  quick.value = 'pick'
}
const pickedSnaps = computed(() => snaps.value.filter(s => picked.value.has(snapKey(s))))
const visibleSnaps = computed(() => (showAll.value ? snaps.value : snaps.value.slice(0, 6)))
const layout = ref('wide')   // wide | each
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dayLabel = date => {
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y || !m || !d) return String(date)
  return `${y !== new Date().getFullYear() ? `${y}/` : ''}${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`
}
const snapSub = s => {
  const items = s.items ?? []
  const blank = items.filter(it => it.qty === null || it.qty === undefined || it.qty === '').length
  return `${items.length}品目${blank ? `・未入力 ${blank}` : ''}`
}
const yen = v => (v == null || v === '' ? '' : `¥${Math.round(Number(v)).toLocaleString('ja-JP')}`)

// 発注・入出庫の記録
const period = ref('thisMonth')   // thisMonth | lastMonth | 3months | custom
const custom = ref({ ...periodRange('thisMonth') })
const range = computed(() => (period.value === 'custom' ? custom.value : periodRange(period.value)))
const records = computed(() => {
  const { from, to } = range.value
  const list = kind.value === 'orders' ? getOrders() : kind.value === 'moves' ? getMovements() : []
  return list.filter(r => !r.deletedAt && (!from || r.date >= from) && (!to || r.date <= to))
})
const md = d => { const [, m, dd] = String(d).split('-').map(Number); return m && dd ? `${m}/${dd}` : '' }

function open(k) {
  kind.value = k
  money.value = true
  if (k === 'stock') { showAll.value = false; layout.value = 'wide'; setQuick('latest1') }
}
function back() { kind.value = '' }

const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const goLabel = computed(() => {
  if (kind.value === 'items') return `${itemTotal.value}品目${!includeHidden.value && hiddenCount.value ? `（非表示の${hiddenCount.value}品目は入れない）` : ''}`
  if (kind.value === 'stock') {
    const n = pickedSnaps.value.length
    if (!n) return '棚卸を選んでください'
    const ds = pickedSnaps.value.map(s => s.date).sort()
    return n === 1 ? `${md(ds[0])} の1回分` : `${n}回分（${md(ds[0])}〜${md(ds[n - 1])}）`
  }
  return `${md(range.value.from)}〜${md(range.value.to)} ・ ${records.value.length}回分`
})
const canGo = computed(() => {
  if (kind.value === 'items') return itemTotal.value > 0
  if (kind.value === 'stock') return pickedSnaps.value.length > 0
  return records.value.length > 0
})
const error = ref('')
async function go() {
  if (!canGo.value) return
  error.value = ''
  try {
    await runBusy('書き出し中…', async () => {
      const m = withMoney.value
      if (kind.value === 'items') {
        await downloadSheets([{ name: '品目リスト', rows: buildItemRows(config, { money: m, includeHidden: includeHidden.value }) }], format.value, `品目リスト_${today()}`)
      } else if (kind.value === 'stock') {
        const sheets = buildStocktakeSheets(pickedSnaps.value, config, { money: m, layout: layout.value })
        const ds = pickedSnaps.value.map(s => s.date).sort()
        await downloadSheets(sheets, format.value, `棚卸結果_${ds[0]}${ds.length > 1 ? `〜${ds[ds.length - 1]}` : ''}`)
      } else {
        const { from, to } = range.value
        const rows = kind.value === 'orders'
          ? buildOrderRows(getOrders(), config, { money: m, from, to })
          : buildMovementRows(getMovements(), config, { money: m, from, to })
        await downloadSheets([{ name: TITLES[kind.value], rows }], format.value, `${TITLES[kind.value]}_${from}〜${to}`)
      }
    })
    emit('close')
  } catch (e) { error.value = e?.message || '書き出せませんでした' }
}
defineExpose({ open })
</script>

<template>
  <div class="ex-back" @click.self="emit('close')">
    <div class="ex" role="dialog" aria-modal="true" :aria-label="kind ? TITLES[kind] : '書き出す種類を選ぶ'">
      <div class="ex-head">
        <button v-if="kind" type="button" class="ex-bk" aria-label="種類を選び直す" @click="back">‹</button>
        <span class="ex-title">{{ kind ? TITLES[kind] : '何を書き出しますか？' }}</span>
        <button type="button" class="ex-x" aria-label="閉じる" @click="emit('close')">✕</button>
      </div>

      <!-- 種類 -->
      <div v-if="!kind" class="ex-box">
        <button type="button" class="ex-it" @click="open('items')">
          <span class="ex-ic">📋</span><span class="ex-tx"><b>品目リスト</b><small>品目・単位・単価・分類・発注点など。このアプリにそのまま取り込めます</small></span><span class="ex-ar">›</span>
        </button>
        <button type="button" class="ex-it" @click="open('stock')">
          <span class="ex-ic">📦</span><span class="ex-tx"><b>棚卸結果</b><small>{{ snaps.length ? 'いつの棚卸か・何回分かを選べます' : '棚卸の記録がまだありません' }}</small></span><span class="ex-ar">›</span>
        </button>
        <button type="button" class="ex-it" @click="open('orders')">
          <span class="ex-ic">🧾</span><span class="ex-tx"><b>発注の記録</b><small>期間の発注（業者・品目・数量）</small></span><span class="ex-ar">›</span>
        </button>
        <button type="button" class="ex-it" @click="open('moves')">
          <span class="ex-ic">📥</span><span class="ex-tx"><b>入出庫の記録</b><small>期間の入庫（納品）・出庫</small></span><span class="ex-ar">›</span>
        </button>
      </div>
      <p v-if="!kind && !mayMoney" class="ex-note">金額は入りません（金額を見る権限がありません）。</p>

      <template v-else-if="kind">
        <!-- 棚卸結果: いつ・何回分 -->
        <template v-if="kind === 'stock'">
          <div class="ex-lab">いつの棚卸</div>
          <div class="ex-quick" role="group" aria-label="いつの棚卸">
            <button v-for="q in [['latest1', '直近1回'], ['latest3', '直近3回'], ['year', '今年'], ['pick', '選ぶ']]" :key="q[0]" type="button"
              :class="{ on: quick === q[0] }" :aria-pressed="quick === q[0]" @click="setQuick(q[0])">{{ q[1] }}</button>
          </div>
          <div class="ex-box">
            <button v-for="s in visibleSnaps" :key="snapKey(s)" type="button" class="ex-it" role="checkbox" :aria-checked="picked.has(snapKey(s))" @click="toggleSnap(s)">
              <span :class="['ex-ck', { on: picked.has(snapKey(s)) }]" aria-hidden="true">{{ picked.has(snapKey(s)) ? '✓' : '' }}</span>
              <span class="ex-tx"><b>{{ dayLabel(s.date) }}</b><small>{{ snapSub(s) }}</small></span>
              <span v-if="mayMoney" class="ex-num">{{ yen(s.totalValue) }}</span>
            </button>
            <p v-if="!snaps.length" class="ex-note pad">棚卸の記録がまだありません</p>
            <button v-if="!showAll && snaps.length > 6" type="button" class="ex-more" @click="showAll = true">もっと前を見る（{{ snaps.length - 6 }}回）</button>
          </div>
        </template>

        <!-- 発注・入出庫: 期間 -->
        <template v-if="kind === 'orders' || kind === 'moves'">
          <div class="ex-lab">期間</div>
          <div class="ex-quick" role="group" aria-label="期間">
            <button v-for="q in [['thisMonth', '今月'], ['lastMonth', '先月'], ['3months', '直近3か月'], ['custom', '日付を選ぶ']]" :key="q[0]" type="button"
              :class="{ on: period === q[0] }" :aria-pressed="period === q[0]" @click="period = q[0]">{{ q[1] }}</button>
          </div>
          <div v-if="period === 'custom'" class="ex-dates">
            <input v-model="custom.from" type="date" aria-label="いつから" /><span>〜</span><input v-model="custom.to" type="date" aria-label="いつまで" />
          </div>
          <p class="ex-note">{{ md(range.from) }}〜{{ md(range.to) }} ・ {{ kind === 'orders' ? '発注' : '入出庫' }} {{ records.length }}回</p>
        </template>

        <div class="ex-lab">形式</div>
        <div class="ex-seg" role="group" aria-label="形式">
          <button type="button" :class="{ on: format === 'xlsx' }" :aria-pressed="format === 'xlsx'" @click="format = 'xlsx'">Excel<small>.xlsx</small></button>
          <button type="button" :class="{ on: format === 'csv' }" :aria-pressed="format === 'csv'" @click="format = 'csv'">CSV<small>.csv</small></button>
        </div>

        <template v-if="kind === 'stock' && pickedSnaps.length > 1">
          <div class="ex-lab">並べ方</div>
          <div class="ex-seg" role="group" aria-label="並べ方">
            <button type="button" :class="{ on: layout === 'wide' }" :aria-pressed="layout === 'wide'" @click="layout = 'wide'">横に並べて1枚<small>品目×日付</small></button>
            <button type="button" :class="{ on: layout === 'each' }" :aria-pressed="layout === 'each'" @click="layout = 'each'">1回ずつ<small>{{ format === 'xlsx' ? 'シートを分ける' : '日付の列で続けて' }}</small></button>
          </div>
        </template>

        <div class="ex-box">
          <div v-if="kind === 'items'" class="ex-it">
            <span class="ex-tx"><b>非表示の品目も入れる</b><small>入れると「非表示」の列に ○ が付きます。取り込み直すと非表示のまま戻ります</small></span>
            <button type="button" class="ex-sw" role="switch" :aria-checked="includeHidden" aria-label="非表示の品目も入れる" @click="includeHidden = !includeHidden"></button>
          </div>
          <div v-if="mayMoney" class="ex-it">
            <span class="ex-tx"><b>{{ kind === 'items' ? '金額（単価）を入れる' : kind === 'stock' ? '金額（単価・在庫金額）を入れる' : '金額（単価・金額）を入れる' }}</b><small v-if="kind === 'stock'">合計も付きます</small></span>
            <button type="button" class="ex-sw" role="switch" :aria-checked="money" aria-label="金額を入れる" @click="money = !money"></button>
          </div>
          <p v-else class="ex-note pad">金額は入りません（金額を見る権限がありません）</p>
        </div>

        <p v-if="kind === 'items'" class="ex-ok">✓ このファイルは「取り込む › 品目リスト」にそのまま入れられます（列を選ぶ問いは出ません）</p>
        <p v-if="kind === 'stock' && (pickedSnaps.length === 1 || (layout === 'each' && format === 'csv'))" class="ex-ok">✓ 「取り込む › 過去の棚卸」にそのまま入れられます</p>
        <p v-if="error" class="ex-err" role="alert">{{ error }}</p>
        <button type="button" class="ex-go" :disabled="!canGo" @click="go">書き出す<small>{{ goLabel }}</small></button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ex-back { position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, .45); display: flex; align-items: flex-end; justify-content: center; }
.ex { box-sizing: border-box; width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; background: var(--bg, #edf5f7); border-radius: 18px 18px 0 0; padding: 4px 12px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; box-shadow: 0 -8px 30px rgba(0, 0, 0, .25); animation: ex-up .22s cubic-bezier(.22, .8, .28, 1); }
@keyframes ex-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .ex { animation: none; } }
.ex-head { display: flex; align-items: center; gap: 8px; padding: 12px 4px 2px; }
.ex-title { flex: 1; font-size: 16px; font-weight: 900; color: var(--text, #12303a); }
.ex-bk, .ex-x { border: none; background: none; cursor: pointer; font-weight: 800; padding: 2px 6px; }
.ex-bk { color: var(--primary, #0e7490); font-size: 22px; line-height: 1; }
.ex-x { color: #7d969c; font-size: 18px; }
.ex-box { background: var(--surface, #fff); border-radius: 14px; overflow: hidden; border: 1px solid var(--border, #d6e6ea); }
.ex-it { box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px; border: none; border-top: 1px solid #eef4f6; background: none; text-align: left; font: inherit; color: var(--text, #12303a); }
button.ex-it { cursor: pointer; }
.ex-box > :first-child { border-top: none; }
.ex-ic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; font-size: 16px; background: #ecfeff; flex: none; }
.ex-tx { flex: 1; min-width: 0; display: grid; }
.ex-tx b { font-size: 14px; font-weight: 800; }
.ex-tx small { font-size: 11.5px; color: var(--text-muted, #4c6a72); margin-top: 2px; line-height: 1.45; }
.ex-ar { color: #94a3b8; font-weight: 900; }
.ex-lab { font-size: 11.5px; font-weight: 800; color: var(--text-muted, #4c6a72); letter-spacing: .04em; padding: 2px 4px 0; }
.ex-quick { display: flex; gap: 6px; flex-wrap: wrap; }
.ex-quick button { min-height: 34px; border: 1px solid var(--border, #d6e6ea); background: #fff; border-radius: 999px; padding: 0 12px; font-size: 12.5px; font-weight: 800; color: var(--text, #12303a); cursor: pointer; }
.ex-quick button.on { background: var(--primary-deep, #155e75); color: #fff; border-color: transparent; }
.ex-seg { display: flex; background: #fff; border-radius: 12px; padding: 3px; gap: 3px; border: 1px solid var(--border, #d6e6ea); }
.ex-seg button { flex: 1; display: grid; place-items: center; min-height: 46px; border: none; border-radius: 9px; background: none; font-size: 13px; font-weight: 800; color: var(--text-muted, #4c6a72); cursor: pointer; }
.ex-seg button small { font-size: 10px; font-weight: 600; opacity: .85; }
.ex-seg button.on { background: var(--primary-deep, #155e75); color: #fff; }
.ex-sw { flex: none; width: 46px; height: 28px; border-radius: 999px; border: none; background: #cbd5e1; position: relative; cursor: pointer; }
.ex-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); }
.ex-sw[aria-checked="true"] { background: var(--primary, #0e7490); }
.ex-sw[aria-checked="true"]::after { left: 21px; }
.ex-ck { width: 22px; height: 22px; border-radius: 7px; border: 2px solid #b8cdd3; flex: none; display: grid; place-items: center; font-size: 13px; color: #fff; font-weight: 900; }
.ex-ck.on { background: var(--primary, #0e7490); border-color: var(--primary, #0e7490); }
.ex-num { font-size: 12px; color: var(--text-muted, #4c6a72); font-weight: 700; font-variant-numeric: tabular-nums; }
.ex-more { width: 100%; min-height: 40px; border: none; border-top: 1px solid #eef4f6; background: none; color: var(--primary, #0e7490); font-weight: 800; font-size: 12.5px; cursor: pointer; }
.ex-dates { display: flex; align-items: center; gap: 6px; }
.ex-dates input { flex: 1; min-width: 0; min-height: 40px; border: 1px solid var(--border, #d6e6ea); border-radius: 10px; padding: 0 8px; font-size: 14px; background: #fff; }
.ex-note { margin: 0; font-size: 11.5px; color: var(--text-muted, #4c6a72); line-height: 1.6; padding: 0 4px; }
.ex-note.pad { padding: 10px 12px; }
.ex-ok { margin: 0; font-size: 11.5px; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 8px 10px; line-height: 1.55; }
.ex-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.ex-go { display: grid; gap: 2px; min-height: 56px; border: none; border-radius: 14px; background: var(--primary, #0e7490); color: #fff; font-size: 15px; font-weight: 900; cursor: pointer; }
.ex-go small { font-size: 11px; font-weight: 600; opacity: .9; }
.ex-go:disabled { background: #94b8c2; cursor: not-allowed; }
</style>
