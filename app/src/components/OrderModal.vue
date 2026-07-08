<script setup>
import { ref, computed, reactive, watch } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useOrders } from '../composables/useOrders.js'

const emit = defineEmits(['close'])
const { config } = useConfig()
const { saveOrder, getOrders, deleteOrder, getLastOrderQty } = useOrders()

// ── グルーピング軸（仕入先など）─────────────────────
const groupOptions = computed(() => {
  const opts = [{ key: 'category', name: 'ジャンル' }]
  const names = config.axisNames ?? ['', '']
  if (names[0]) opts.push({ key: 'axisA', name: names[0] })
  if (names[1]) opts.push({ key: 'axisB', name: names[1] })
  return opts
})
const groupKey = ref('category')
watch(groupOptions, (opts) => {
  if (opts.some(o => o.key === groupKey.value)) return
  // 「仕入先」らしい軸を優先、無ければ最後の軸、無ければジャンル
  const supplierish = opts.find(o => /仕入|業者|取引|ベンダー|supplier/i.test(o.name))
  groupKey.value = (supplierish || opts[opts.length - 1] || opts[0]).key
}, { immediate: true })

const groupName = computed(() => groupOptions.value.find(o => o.key === groupKey.value)?.name ?? '')

function _tagsOf(item) {
  if (groupKey.value === 'axisA') return config.tagsA?.[item] || []
  if (groupKey.value === 'axisB') return config.tagsB?.[item] || []
  return config.categories?.[item] ? [config.categories[item]] : []
}

// 発注先（グループ）の一覧
const suppliers = computed(() => {
  if (groupKey.value === 'category') {
    const set = new Set(config.order.map(i => config.categories?.[i]).filter(Boolean))
    return [...set].sort((a, b) => {
      const ca = config.categoryCodes?.[a], cb = config.categoryCodes?.[b]
      if (ca != null && cb != null) return ca - cb
      if (ca != null) return -1
      if (cb != null) return  1
      return a.localeCompare(b, 'ja')
    })
  }
  const defined = groupKey.value === 'axisA' ? (config.axisGroupsA ?? []) : (config.axisGroupsB ?? [])
  const set = new Set(defined)
  for (const i of config.order) for (const g of _tagsOf(i)) set.add(g)
  return [...set]
})

const selectedSupplier = ref('')
watch([groupKey, suppliers], () => {
  if (!suppliers.value.includes(selectedSupplier.value)) selectedSupplier.value = ''
})

const itemsForSupplier = computed(() => {
  if (!selectedSupplier.value) return []
  return config.order.filter(i => _tagsOf(i).includes(selectedSupplier.value))
})

// ── 数量入力 ────────────────────────────────────
const qtyInput = reactive({})
const prevQty = computed(() => getLastOrderQty(selectedSupplier.value))
function unitOf(item) { return config.units?.[item] || '' }

const enteredCount = computed(() =>
  itemsForSupplier.value.filter(i => Number(qtyInput[i]) > 0).length
)

function onSave() {
  const lines = itemsForSupplier.value.map(i => ({ item: i, qty: Number(qtyInput[i]), unit: unitOf(i) }))
  const rec = saveOrder({ supplier: selectedSupplier.value, axis: groupName.value, lines })
  if (!rec) { flashMsg('数量を入力してください'); return }
  for (const i of itemsForSupplier.value) delete qtyInput[i]
  flashMsg(`「${selectedSupplier.value}」に ${rec.lines.length}品目を発注記録しました`)
}

const flash = ref('')
let _flashT = null
function flashMsg(m) { flash.value = m; clearTimeout(_flashT); _flashT = setTimeout(() => { flash.value = '' }, 2200) }

// ── 履歴 ────────────────────────────────────────
const showHistory = ref(false)
const orders = computed(() => getOrders())
const expanded = reactive({})
function toggleOrder(id) { expanded[id] = !expanded[id] }
function onDeleteOrder(id) {
  if (!confirm('この発注記録を削除しますか？')) return
  deleteOrder(id)
}
function _fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const W = ['日', '月', '火', '水', '木', '金', '土']
  return `${dt.getMonth() + 1}/${dt.getDate()}（${W[dt.getDay()]}）`
}
</script>

<template>
  <div class="od-overlay">
    <div class="od-header">
      <button class="od-back" @click="emit('close')">‹ 戻る</button>
      <div class="od-title">🧾 発注</div>
      <button class="od-hist-btn" :class="{ on: showHistory }" @click="showHistory = !showHistory">履歴</button>
    </div>

    <div class="od-body">
      <!-- 履歴ビュー -->
      <template v-if="showHistory">
        <div v-if="orders.length === 0" class="od-empty">発注の記録はまだありません</div>
        <div v-for="o in orders" :key="o.id" class="od-order">
          <div class="od-order-head" @click="toggleOrder(o.id)">
            <span class="od-order-date">{{ _fmtDate(o.date) }}</span>
            <span class="od-order-sup">{{ o.supplier || '（未分類）' }}</span>
            <span class="od-order-cnt">{{ o.lines.length }}品目</span>
            <button class="od-order-del" @click.stop="onDeleteOrder(o.id)">🗑</button>
          </div>
          <div v-if="expanded[o.id]" class="od-order-lines">
            <div v-for="l in o.lines" :key="l.item" class="od-order-line">
              <span>{{ l.item }}</span><span>{{ l.qty }}{{ l.unit }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 発注入力ビュー -->
      <template v-else>
        <div class="od-picker">
          <label class="od-picker-label">発注先の分け方</label>
          <div class="od-seg">
            <button v-for="opt in groupOptions" :key="opt.key"
                    :class="['od-seg-btn', { on: groupKey === opt.key }]"
                    @click="groupKey = opt.key">{{ opt.name }}</button>
          </div>
        </div>

        <div class="od-suppliers">
          <button v-for="s in suppliers" :key="s"
                  :class="['od-sup-chip', { on: selectedSupplier === s }]"
                  @click="selectedSupplier = s">{{ s }}</button>
          <div v-if="suppliers.length === 0" class="od-none">
            {{ groupName }}が未設定です。設定でジャンルや軸を割り当ててください。
          </div>
        </div>

        <div v-if="selectedSupplier" class="od-items">
          <div class="od-items-head">
            <span>{{ selectedSupplier }}（{{ itemsForSupplier.length }}品目）</span>
          </div>
          <div v-for="item in itemsForSupplier" :key="item" class="od-row">
            <span class="od-item-name">{{ item }}</span>
            <span v-if="prevQty[item] != null" class="od-prev">前回 {{ prevQty[item] }}</span>
            <input v-model="qtyInput[item]" type="number" min="0" inputmode="decimal"
                   class="od-qty" placeholder="0" />
            <span class="od-unit">{{ unitOf(item) }}</span>
          </div>
          <div v-if="itemsForSupplier.length === 0" class="od-none">この発注先に品目がありません</div>
        </div>
        <div v-else class="od-hint">上で発注先を選んでください</div>
      </template>
    </div>

    <div v-if="!showHistory && selectedSupplier" class="od-footer">
      <button class="od-save" :disabled="enteredCount === 0" @click="onSave">
        発注を記録（{{ enteredCount }}品目）
      </button>
    </div>

    <div v-if="flash" class="od-flash">{{ flash }}</div>
  </div>
</template>

<style scoped>
.od-overlay { position: fixed; inset: 0; z-index: 2100; background: #f5f6f8; display: flex; flex-direction: column; }
.od-header { display: flex; align-items: center; padding: 12px 14px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.od-back { background: none; border: none; color: var(--primary); font-size: 16px; cursor: pointer; padding: 4px 6px; }
.od-title { font-weight: 700; font-size: 15px; flex: 1; text-align: center; }
.od-hist-btn { border: 1.5px solid #d1d5db; background: #fff; border-radius: 8px; font-size: 12px; font-weight: 700; color: #4b5563; padding: 5px 10px; cursor: pointer; }
.od-hist-btn.on { border-color: var(--primary); color: var(--primary); background: var(--primary-weak); }

.od-body { flex: 1; overflow-y: auto; padding: 14px; -webkit-overflow-scrolling: touch; }
.od-empty, .od-none, .od-hint { padding: 24px; text-align: center; color: #9ca3af; font-size: 13px; }

.od-picker-label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 6px; }
.od-seg { display: flex; gap: 6px; margin-bottom: 14px; }
.od-seg-btn { flex: 1; padding: 8px; border: 1.5px solid #d1d5db; background: #fff; border-radius: 9px; font-weight: 700; font-size: 13px; color: #6b7280; cursor: pointer; }
.od-seg-btn.on { border-color: var(--primary); color: var(--primary); background: var(--primary-weak); }

.od-suppliers { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.od-sup-chip { border: 1.5px solid #d1d5db; background: #fff; border-radius: 20px; padding: 7px 14px; font-size: 13px; color: #4b5563; cursor: pointer; }
.od-sup-chip.on { border-color: var(--primary); background: var(--primary); color: #fff; }

.od-items { background: #fff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; }
.od-items-head { padding: 10px 12px; font-size: 12px; font-weight: 700; color: #374151; background: #f8fafc; border-bottom: 1px solid #eef0f2; }
.od-row { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #f3f4f6; }
.od-item-name { flex: 1; font-size: 14px; color: #374151; word-break: break-all; }
.od-prev { font-size: 11px; color: #9ca3af; flex-shrink: 0; }
.od-qty { width: 66px; flex-shrink: 0; border: 1.5px solid #d1d5db; border-radius: 8px; padding: 7px 8px; font-size: 15px; text-align: right; outline: none; }
.od-qty:focus { border-color: var(--primary); }
.od-unit { width: 34px; flex-shrink: 0; font-size: 12px; color: #6b7280; }

.od-order { background: #fff; border-radius: 10px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); overflow: hidden; }
.od-order-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; }
.od-order-date { font-size: 12px; color: #6b7280; flex-shrink: 0; }
.od-order-sup { flex: 1; font-size: 14px; font-weight: 700; color: #374151; }
.od-order-cnt { font-size: 11px; color: #9ca3af; }
.od-order-del { border: none; background: none; cursor: pointer; font-size: 14px; }
.od-order-lines { border-top: 1px solid #f3f4f6; }
.od-order-line { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 13px; color: #4b5563; border-top: 1px solid #f8fafc; }

.od-footer { flex-shrink: 0; padding: 10px 14px; background: #fff; border-top: 1px solid #e5e7eb; }
.od-save { width: 100%; border: none; background: var(--primary); color: #fff; font-weight: 700; font-size: 15px; border-radius: 12px; padding: 13px; cursor: pointer; }
.od-save:disabled { background: #cbd5e1; cursor: not-allowed; }

.od-flash { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 2200; background: #1f2937; color: #fff; font-size: 13px; font-weight: 700; padding: 10px 16px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); max-width: 90%; text-align: center; }
</style>
