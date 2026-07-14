<script setup>
import { ref, computed, reactive } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useMovements, deliveryLinesFromOrder } from '../composables/useMovements.js'
import { useOrders } from '../composables/useOrders.js'
import { theoreticalStock } from '../services/theoreticalStock.js'
import { parseLot } from '../services/lot.js'

const emit = defineEmits(['back', 'saved'])

const { config } = useConfig()
const { getSnapshots } = useHistory()
const { saveMovement, getMovements } = useMovements()
const { getOrders } = useOrders()

const date  = ref(new Date().toISOString().slice(0, 10))
const note  = ref('')
const search = ref('')
const linkedOrderId = ref(null)
const linkedLabel   = ref('')

// 品目ごとの増減量。正=入庫・負=出庫・0/空=変更なし。
const deltas = reactive({})

const hiddenSet = computed(() => new Set(config.hiddenItems || []))
const allItems = computed(() => (config.order || []).filter(n => !hiddenSet.value.has(n)))

const filteredItems = computed(() => {
  const q = search.value.trim()
  if (!q) return allItems.value
  return allItems.value.filter(n => n.includes(q))
})

// ── グループ化（ジャンル＝取込由来 / 軸＝自作）──────────────
const groupMode = ref('category')  // 'category' | 'axisA' | 'axisB'
const groupOpts = computed(() => {
  const opts = [{ value: 'category', label: 'ジャンル' }]
  const names = config.axisNames ?? ['', '']
  if (names[0]) opts.push({ value: 'axisA', label: names[0] })
  if (names[1]) opts.push({ value: 'axisB', label: names[1] })
  return opts
})
// 選択中の軸が未設定なら category にフォールバック
const effectiveGroup = computed(() => {
  const names = config.axisNames ?? ['', '']
  if (groupMode.value === 'axisA' && !names[0]) return 'category'
  if (groupMode.value === 'axisB' && !names[1]) return 'category'
  return groupMode.value
})
const UNGROUPED = '未分類'
function _groupsOf(item) {
  if (effectiveGroup.value === 'category') {
    const c = (config.categories?.[item] || '').trim()
    return [c || UNGROUPED]
  }
  const src = effectiveGroup.value === 'axisA' ? config.tagsA : config.tagsB
  const raw = src?.[item]
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [raw] : [])
  return arr.length ? arr : [UNGROUPED]
}

const groups = computed(() => {
  const map = new Map()
  for (const item of filteredItems.value) {
    for (const g of _groupsOf(item)) {
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(item)
    }
  }
  const entries = [...map.entries()].sort(([a], [b]) => {
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    return a.localeCompare(b, 'ja')
  })
  return entries.map(([label, items]) => ({
    label,
    items,
    changedCount: items.filter(n => _delta(n) !== 0).length,
  }))
})

// アコーディオン: 初期は全て閉じる。検索中は結果を隠さないよう強制展開。
const expanded = reactive({})
function _gkey(label) { return effectiveGroup.value + '::' + label }
function isOpen(label) { return !!search.value.trim() || !!expanded[_gkey(label)] }
function toggleGroup(label) {
  const k = _gkey(label)
  if (expanded[k]) delete expanded[k]
  else expanded[k] = true
}
function collapseAll() { for (const k of Object.keys(expanded)) delete expanded[k] }
function expandAll() { for (const g of groups.value) expanded[_gkey(g.label)] = true }
const anyOpen = computed(() => groups.value.some(g => expanded[_gkey(g.label)]))

const _snaps = computed(() => getSnapshots())
const _moves = computed(() => getMovements())
function theoOf(item) {
  const t = theoreticalStock(item, _snaps.value, _moves.value)
  return t ? t.qty : null
}
function unitOf(item) { return config.units?.[item] ?? '' }

// 入数（ケース1箱あたりのバラ数）。未設定なら null＝変換不要（バラ入力のみ）。
function lotOf(item) { return parseLot(config.lotSizes?.[item]) }
function hasLot(item) { return (lotOf(item) ?? 1) > 1 }

function _delta(item) {
  const v = Number(deltas[item])
  return Number.isFinite(v) ? v : 0
}
function step(item, d) {
  deltas[item] = Math.round((_delta(item) + d) * 1000) / 1000
}
// ケース単位で増減（＋入庫/−出庫）。入数ぶんのバラに変換して delta に足す。
function stepCase(item, sign) {
  const lot = lotOf(item)
  if (lot) step(item, sign * lot)
}
function onInput(item, e) {
  const v = e.target.value
  deltas[item] = v === '' || v === '-' ? 0 : Number(v)
}
// バラ数 → ケース内訳の表示（入数がある品目のみ）。例: 53本(入数24) → "2ケース +5"
function caseBreakdown(item) {
  const lot = lotOf(item)
  const d = _delta(item)
  if (!lot || d === 0) return ''
  const sign = d < 0 ? '−' : ''
  const abs = Math.abs(d)
  const cases = Math.floor(abs / lot)
  const rem = Math.round((abs - cases * lot) * 1000) / 1000
  if (cases === 0) return ''
  return `${sign}${cases}ケース${rem ? ` +${rem}` : ''}`
}

// 変更のある品目（記録対象）
const changed = computed(() => allItems.value.filter(n => _delta(n) !== 0))
const inLines = computed(() => changed.value.filter(n => _delta(n) > 0).map(n => ({ item: n, qty: _delta(n), unit: unitOf(n) })))
const outLines = computed(() => changed.value.filter(n => _delta(n) < 0).map(n => ({ item: n, qty: -_delta(n), unit: unitOf(n) })))
const canSave = computed(() => changed.value.length > 0)

// ── 発注→入庫の一括プリフィル ─────────────────────────────
const _importedOrderIds = computed(() => new Set(_moves.value.map(m => m.orderId).filter(Boolean)))
function _mdLabel(d) {
  const [, mo, dd] = String(d || '').split('-').map(Number)
  return mo && dd ? `${mo}/${dd}` : ''
}
const pendingOrders = computed(() => {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  return getOrders().filter(o => (o.date || '') >= since && !_importedOrderIds.value.has(o.id)).slice(0, 5)
})
function importOrder(o) {
  const dl = deliveryLinesFromOrder(o)
  if (dl.length === 0) return
  for (const l of dl) deltas[l.item] = (_delta(l.item)) + l.qty  // 入庫＝＋
  linkedOrderId.value = o.id
  linkedLabel.value = `${_mdLabel(o.date)} ${o.supplier || '（未分類）'}`
  if (!note.value) note.value = `${_mdLabel(o.date)}発注分の納品`
}
function unlinkOrder() { linkedOrderId.value = null; linkedLabel.value = '' }

function onSave() {
  const dateVal = date.value
  const noteVal = note.value
  // マイナス品目 → 出庫レコード（紐付けなし）
  if (outLines.value.length) {
    saveMovement({ type: 'out', date: dateVal, note: noteVal, lines: outLines.value })
  }
  // プラス品目 → 入庫レコード（発注紐付けは入庫のみ）
  if (inLines.value.length) {
    saveMovement({ type: 'in', date: dateVal, note: noteVal, orderId: linkedOrderId.value, lines: inLines.value })
  }
  emit('saved')
  emit('back')
}
</script>

<template>
  <div class="mv">
    <header class="mv-header">
      <button class="mv-back" @click="emit('back')">‹ 戻る</button>
      <span class="mv-title">📦 入出庫</span>
      <span v-if="changed.length" class="mv-count">{{ changed.length }}品目</span>
    </header>

    <div class="mv-scroll">
      <!-- 日付・メモ -->
      <div class="mv-controls">
        <div class="mv-ctl-row">
          <label class="mv-ctl-label">日付</label>
          <input v-model="date" type="date" class="mv-date" />
        </div>
        <input v-model="note" type="text" class="mv-note" placeholder="メモ（任意）例: 火曜納品分 / 棚卸調整" />
      </div>

      <!-- 発注→入庫の取込 -->
      <div v-if="linkedOrderId" class="mv-linked">
        🧾 {{ linkedLabel }} の発注を入庫にプリフィル済み
        <button class="mv-linked-clear" @click="unlinkOrder">解除</button>
      </div>
      <div v-else-if="pendingOrders.length" class="mv-orders">
        <div class="mv-orders-title">未入庫の発注から取り込む</div>
        <div class="mv-orders-chips">
          <button v-for="o in pendingOrders" :key="o.id" class="mv-order-chip" @click="importOrder(o)">
            🧾 {{ _mdLabel(o.date) }} {{ o.supplier || '（未分類）' }}（{{ o.lines.length }}品目）
          </button>
        </div>
      </div>

      <!-- 品目検索 -->
      <input v-model="search" type="text" class="mv-search" placeholder="品目名で絞り込み" />

      <!-- グループ切替 -->
      <div class="mv-groupbar">
        <div class="mv-seg">
          <button
            v-for="o in groupOpts" :key="o.value"
            :class="['mv-seg-btn', { on: effectiveGroup === o.value }]"
            @click="groupMode = o.value"
          >{{ o.label }}</button>
        </div>
        <button v-if="!search.trim()" class="mv-toggle-all" @click="anyOpen ? collapseAll() : expandAll()">
          {{ anyOpen ? 'すべて閉じる' : 'すべて開く' }}
        </button>
      </div>

      <div class="mv-hint">＋で入庫・−で出庫。0 の品目は記録されません。</div>

      <!-- グループ（アコーディオン） -->
      <div v-if="groups.length" class="mv-groups">
        <div v-for="g in groups" :key="g.label" class="mv-group">
          <button class="mv-group-head" @click="toggleGroup(g.label)">
            <span class="mv-group-arrow">{{ isOpen(g.label) ? '▾' : '▸' }}</span>
            <span class="mv-group-name">{{ g.label }}</span>
            <span class="mv-group-count">{{ g.items.length }}</span>
            <span v-if="g.changedCount" class="mv-group-badge">{{ g.changedCount }}</span>
          </button>
          <div v-if="isOpen(g.label)" class="mv-list">
            <div v-for="item in g.items" :key="item" :class="['mv-item', { changed: _delta(item) !== 0 }]">
              <div class="mv-item-info">
                <span class="mv-item-name">{{ item }}</span>
                <span class="mv-item-theo">
                  理論 {{ theoOf(item) != null ? theoOf(item) : '—' }}{{ unitOf(item)
                  }}<template v-if="_delta(item) !== 0 && theoOf(item) != null"> → <b :class="_delta(item) > 0 ? 'up' : 'down'">{{ theoOf(item) + _delta(item) }}</b></template>
                  <span v-if="hasLot(item)" class="mv-lot">入数{{ lotOf(item) }}</span>
                  <span v-if="caseBreakdown(item)" class="mv-cases">{{ caseBreakdown(item) }}</span>
                </span>
              </div>
              <div class="mv-row-ctl">
                <div v-if="hasLot(item)" class="mv-case-ctl">
                  <button class="mv-case-btn out" @click="stepCase(item, -1)" type="button" title="1ケース出庫">−箱</button>
                  <button class="mv-case-btn in" @click="stepCase(item, 1)" type="button" title="1ケース入庫">＋箱</button>
                </div>
                <div class="mv-stepper">
                  <button class="mv-step out" @click="step(item, -1)" type="button">−</button>
                  <input
                    class="mv-step-val"
                    :class="{ pos: _delta(item) > 0, neg: _delta(item) < 0 }"
                    type="number" inputmode="numeric"
                    :value="_delta(item) || ''"
                    placeholder="0"
                    @input="onInput(item, $event)"
                  />
                  <button class="mv-step in" @click="step(item, 1)" type="button">＋</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="mv-empty">
        <template v-if="allItems.length === 0">表示中の品目がありません。品目マスタを登録してください。</template>
        <template v-else>「{{ search }}」に一致する品目がありません。</template>
      </div>
    </div>

    <!-- 保存バー -->
    <div class="mv-savebar">
      <div class="mv-save-summary">
        <span v-if="inLines.length" class="mv-sum in">入庫 {{ inLines.length }}</span>
        <span v-if="outLines.length" class="mv-sum out">出庫 {{ outLines.length }}</span>
        <span v-if="!changed.length" class="mv-sum none">変更なし</span>
      </div>
      <button class="mv-save" :disabled="!canSave" @click="onSave">記録する</button>
    </div>
  </div>
</template>

<style scoped>
.mv { min-height: 100dvh; background: #f8fafc; display: flex; flex-direction: column; }
.mv-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.mv-back { border: none; background: none; color: #059669; font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.mv-title { font-size: 16px; font-weight: 800; color: #065f46; }
.mv-count { margin-left: auto; font-size: 13px; font-weight: 800; color: #059669; }
.mv-scroll { flex: 1; padding: 14px; max-width: 620px; margin: 0 auto; width: 100%; overflow-y: auto; }

.mv-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.mv-ctl-row { display: flex; align-items: center; gap: 10px; }
.mv-ctl-label { font-size: 13px; font-weight: 700; color: #64748b; flex-shrink: 0; }
.mv-date { flex: 1; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; font-size: 14px; color: #1e293b; background: #fff; }
.mv-note { border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 14px; }

.mv-orders { margin-bottom: 10px; }
.mv-orders-title { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px; }
.mv-orders-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mv-order-chip { border: 1px solid #fed7aa; background: #fff7ed; color: #c2410c; border-radius: 10px; padding: 8px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.mv-order-chip:active { background: #ffedd5; }
.mv-linked { font-size: 12px; font-weight: 600; color: #9a3412; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.mv-linked-clear { margin-left: auto; border: none; background: none; color: #ea580c; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; }

.mv-search { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-bottom: 8px; }
.mv-search:focus { outline: none; border-color: #34d399; }
.mv-hint { font-size: 11.5px; color: #94a3b8; margin-bottom: 10px; }

.mv-groupbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mv-seg { display: inline-flex; background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 10px; padding: 2px; gap: 2px; }
.mv-seg-btn { border: none; background: none; border-radius: 8px; padding: 6px 12px; font-size: 12.5px; font-weight: 700; color: #059669; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-seg-btn.on { background: #059669; color: #fff; }
.mv-toggle-all { margin-left: auto; border: none; background: none; color: #059669; font-size: 12px; font-weight: 700; cursor: pointer; padding: 4px; flex-shrink: 0; }

.mv-groups { display: flex; flex-direction: column; gap: 8px; }
.mv-group { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
.mv-group-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: none; border: none; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
.mv-group-head:active { background: #f0fdf9; }
.mv-group-arrow { font-size: 12px; color: #10b981; width: 12px; flex-shrink: 0; }
.mv-group-name { font-size: 14px; font-weight: 800; color: #065f46; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-group-count { font-size: 12px; font-weight: 700; color: #94a3b8; }
.mv-group-badge { margin-left: auto; font-size: 11px; font-weight: 800; color: #fff; background: #10b981; border-radius: 10px; padding: 1px 8px; flex-shrink: 0; }

.mv-list { display: flex; flex-direction: column; }
.mv-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid #f1f5f9; }
.mv-item.changed { background: #f0fdf9; }
.mv-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mv-item-name { font-size: 14px; font-weight: 700; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-item-theo { font-size: 11.5px; color: #94a3b8; }
.mv-item-theo b.up { color: #059669; }
.mv-item-theo b.down { color: #dc2626; }
.mv-lot { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 8px; padding: 1px 6px; }
.mv-cases { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #059669; }

.mv-row-ctl { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.mv-case-ctl { display: flex; flex-direction: column; gap: 3px; }
.mv-case-btn { border: 1.5px solid #e2e8f0; background: #fff; border-radius: 7px; padding: 2px 6px; font-size: 11px; font-weight: 800; cursor: pointer; line-height: 1.3; -webkit-tap-highlight-color: transparent; white-space: nowrap; }
.mv-case-btn.in { color: #059669; border-color: #a7f3d0; }
.mv-case-btn.out { color: #dc2626; border-color: #fecaca; }
.mv-case-btn:active { transform: scale(0.94); }

.mv-stepper { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.mv-step { width: 34px; height: 34px; border-radius: 9px; border: 1.5px solid #e2e8f0; background: #fff; font-size: 18px; font-weight: 700; cursor: pointer; line-height: 1; -webkit-tap-highlight-color: transparent; }
.mv-step.in { color: #059669; }
.mv-step.out { color: #dc2626; }
.mv-step:active { transform: scale(0.94); }
.mv-step-val { width: 52px; height: 34px; border: 1.5px solid #e2e8f0; border-radius: 8px; text-align: center; font-size: 15px; font-weight: 700; color: #64748b; }
.mv-step-val.pos { color: #059669; border-color: #a7f3d0; }
.mv-step-val.neg { color: #dc2626; border-color: #fecaca; }

.mv-empty { padding: 30px 16px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; }

.mv-savebar {
  position: sticky; bottom: 0;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: #fff; border-top: 1px solid #e2e8f0;
  max-width: 620px; margin: 0 auto; width: 100%;
}
.mv-save-summary { flex: 1; display: flex; gap: 8px; font-size: 13px; font-weight: 700; }
.mv-sum.in { color: #059669; }
.mv-sum.out { color: #dc2626; }
.mv-sum.none { color: #94a3b8; }
.mv-save { border: none; border-radius: 12px; padding: 12px 24px; font-size: 15px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #34d399 0%, #059669 100%); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-save:disabled { opacity: 0.4; cursor: not-allowed; }
.mv-save:active { transform: scale(0.98); }
</style>
