<script setup>
import { ref, computed, reactive, watch } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'

const props = defineProps({ initialAxis: { type: Number, default: null } })
const emit = defineEmits(['close'])

const { config, addAxisGroup, renameAxisGroup, removeAxisGroup, addItemToGroup, removeItemFromGroup, moveAxisGroup, moveAxisGroupToTop, copyCategoryToAxis } = useConfig()
const { getSnapshots } = useHistory()

// ── 対象の軸 ────────────────────────────────────
const namedAxes = computed(() => {
  const names = config.axisNames ?? ['', '']
  const out = []
  if (names[0]) out.push({ index: 0, name: names[0] })
  if (names[1]) out.push({ index: 1, name: names[1] })
  return out
})
const activeAxis = ref(props.initialAxis ?? 0)
watch(namedAxes, (arr) => {
  if (!arr.some(a => a.index === activeAxis.value)) activeAxis.value = arr[0]?.index ?? 0
}, { immediate: true })

const hasItems = computed(() => (config.order?.length ?? 0) > 0)
const tagMap  = computed(() => activeAxis.value === 0 ? (config.tagsA ?? {}) : (config.tagsB ?? {}))
const defined = computed(() => activeAxis.value === 0 ? (config.axisGroupsA ?? []) : (config.axisGroupsB ?? []))
const displayGroups = computed(() => {
  const set = new Set(defined.value)
  for (const v of Object.values(tagMap.value)) for (const g of (v || [])) set.add(g)
  return [...set]
})

function itemGroups(item) { return tagMap.value[item] || [] }
function isAssigned(item) { return itemGroups(item).length > 0 }

const groupCount = computed(() => {
  const m = {}
  for (const g of displayGroups.value) m[g] = 0
  for (const item of config.order) for (const g of itemGroups(item)) m[g] = (m[g] || 0) + 1
  return m
})

// ── 左ペイン（デフォルト＝ジャンル別アコーディオン） ──
const USAGE_SESSIONS = 3
const usageMap = computed(() => {
  const snaps = getSnapshots().slice(0, USAGE_SESSIONS)
  const m = {}
  for (const s of snaps) for (const it of (s.items || [])) {
    if (it.qty !== null && it.qty !== undefined) m[it.item] = (m[it.item] || 0) + 1
  }
  return m
})
const hasUsage = computed(() => Object.keys(usageMap.value).length > 0)
const usedOnly = ref(false)
const search   = ref('')

// カタカナ半角/全角・英数字全半角を無視して検索するための正規化
const _norm = (s) => (s || '').normalize('NFKC').toLowerCase()
const leftGroups = computed(() => {
  const q = _norm(search.value.trim())
  const map = new Map()
  for (const item of config.order) {
    if (usedOnly.value && !(usageMap.value[item] > 0)) continue
    if (q && !_norm(item).includes(q)) continue
    const cat = config.categories?.[item] || 'その他'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(item)
  }
  const entries = [...map.entries()].sort(([a], [b]) => {
    if (a === 'その他') return 1
    if (b === 'その他') return -1
    const ca = config.categoryCodes?.[a], cb = config.categoryCodes?.[b]
    if (ca != null && cb != null) return ca - cb
    if (ca != null) return -1
    if (cb != null) return  1
    return a.localeCompare(b, 'ja')
  })
  return entries.map(([cat, items]) => ({
    cat,
    items,
    assigned: items.filter(i => isAssigned(i)).length,
  }))
})

// 左のアコーディオンは初期は全て閉じておく
const opened = reactive({})
function toggleCat(cat) { opened[cat] = !opened[cat] }
function isOpen(cat) { return !!opened[cat] }

// ── 振り分け対象グループ ────────────────────────
const targetGroup = ref('')
watch(activeAxis, () => { targetGroup.value = ''; search.value = '' })

// 振り分け先グループの選択（同じものを再タップで選択解除＝閉じる）
function selectGroup(g) { targetGroup.value = targetGroup.value === g ? '' : g }

// 振り分け先未選択でタップされた時の案内
const flash = ref('')
let _flashT = null
function flashMsg(m) { flash.value = m; clearTimeout(_flashT); _flashT = setTimeout(() => { flash.value = '' }, 2200) }

// ── 振り分け操作（複数所属は確認モーダル） ────────
const pendingItem = ref(null)
function attemptAssign(item) {
  if (!targetGroup.value) { flashMsg('先に右で振り分け先（' + (activeName.value || '場所') + '）を選んでください'); return }
  const cur = itemGroups(item)
  if (cur.includes(targetGroup.value)) {            // 既にそのグループにある→タップで外す（誤操作の取り消し）
    removeItemFromGroup(activeAxis.value, item, targetGroup.value)
    flashMsg(`「${item}」を${targetGroup.value}から外しました`)
    return
  }
  if (cur.length > 0) { pendingItem.value = item; return }  // 別の場所に既にある→確認
  addItemToGroup(activeAxis.value, item, targetGroup.value)
}
function confirmMulti() {
  if (pendingItem.value) addItemToGroup(activeAxis.value, pendingItem.value, targetGroup.value)
  pendingItem.value = null
}
function removeFrom(item, group) { removeItemFromGroup(activeAxis.value, item, group) }

// 並び替え（定義済みグループのみ）
function definedIndex(g) { return defined.value.indexOf(g) }
function move(g, dir) { moveAxisGroup(activeAxis.value, g, dir) }
function moveTop(g) { moveAxisGroupToTop(activeAxis.value, g) }

// ── グループ管理 ──────────────────────────────
const newGroupName = ref('')
function onAddGroup() {
  const n = newGroupName.value.trim()
  if (!n) return
  addAxisGroup(activeAxis.value, n)
  if (!targetGroup.value) targetGroup.value = n
  newGroupName.value = ''
}

// 左のジャンルを1個だけコピーしてグループ化
function onCopyCategory(cat) {
  const n = copyCategoryToAxis(activeAxis.value, cat)
  if (n > 0) { targetGroup.value = cat; flashMsg(`「${cat}」を${n}件コピーしました`) }
}
function onRenameGroup(g) {
  const nn = (prompt(`「${g}」の新しい名前`, g) || '').trim()
  if (!nn || nn === g) return
  if (!renameAxisGroup(activeAxis.value, g, nn)) { alert('その名前は既に使われています'); return }
  if (targetGroup.value === g) targetGroup.value = nn
}
function onDeleteGroup(g) {
  const cnt = groupCount.value[g] || 0
  if (!confirm(`「${g}」を削除します。${cnt}件の割り当ては解除されます。よろしいですか？`)) return
  removeAxisGroup(activeAxis.value, g)
  if (targetGroup.value === g) targetGroup.value = ''
}

const activeName = computed(() => namedAxes.value.find(a => a.index === activeAxis.value)?.name ?? '')
</script>

<template>
  <div class="ax-overlay">
    <div class="ax-header">
      <button class="ax-back" @click="emit('close')">‹ 戻る</button>
      <div class="ax-title">🗂️ {{ activeName || '分類' }}の振り分け</div>
      <div class="ax-spacer"></div>
    </div>

    <div v-if="namedAxes.length === 0" class="ax-empty">
      <div class="ax-empty-icon">🏷️</div>
      <div class="ax-empty-title">並び替えの名前が未設定です</div>
      <div class="ax-empty-desc">メニューの「並び替え」で名前（例：場所・仕入先）を先に入力してください。</div>
    </div>

    <template v-else>
      <div v-if="namedAxes.length > 1" class="ax-tabs">
        <button v-for="a in namedAxes" :key="a.index"
                :class="['ax-tab', { on: activeAxis === a.index }]"
                @click="activeAxis = a.index">{{ a.name }}</button>
      </div>

      <div v-if="!hasItems" class="ax-warn">
        <span class="ax-warn-icon">📦</span>
        <div>
          <div class="ax-warn-title">品目がまだありません</div>
          <div class="ax-warn-desc">先にメニューの「品目のインポート」で品目を追加すると、ここで振り分けできます。グループだけ先に作っておくことも可能です。</div>
        </div>
      </div>

      <div class="ax-hint">
        右で<b>グループを選択</b> → 左で<b>品目をタップ</b>して振り分け。
        <span v-if="targetGroup">振り分け先：<b class="ax-target">{{ targetGroup }}</b></span>
        <span v-else class="ax-target-none">振り分け先を選んでください</span>
      </div>

      <div class="ax-split">
        <!-- 左：ジャンル別（デフォルト）の品目一覧 -->
        <div class="ax-pane ax-left">
          <div class="ax-pane-tools">
            <input v-model="search" type="text" placeholder="検索" class="ax-mini-input" />
            <button v-if="hasUsage" :class="['ax-mini', { on: usedOnly }]" @click="usedOnly = !usedOnly">前回0を非表示</button>
          </div>
          <div class="ax-scroll">
            <template v-for="grp in leftGroups" :key="grp.cat">
              <div class="ax-cat-head" @click="toggleCat(grp.cat)">
                <span class="ax-cat-arrow">{{ isOpen(grp.cat) ? '▼' : '▶' }}</span>
                <span class="ax-cat-name">{{ grp.cat }}</span>
                <span class="ax-cat-right">
                  <span class="ax-cat-count"><strong>{{ grp.assigned }}</strong>/{{ grp.items.length }}</span>
                  <button v-if="grp.cat !== 'その他'" class="ax-cat-copy" @click.stop="onCopyCategory(grp.cat)">📋コピー</button>
                </span>
              </div>
              <template v-if="isOpen(grp.cat)">
                <button
                  v-for="item in grp.items" :key="item"
                  :class="['ax-li', { assigned: isAssigned(item), disabled: !targetGroup }]"
                  @click="attemptAssign(item)"
                >
                  <span class="ax-li-name">{{ item }}</span>
                  <span v-if="itemGroups(item).length" class="ax-li-tags">
                    <span v-for="g in itemGroups(item)" :key="g" class="ax-li-tag">{{ g }}</span>
                  </span>
                  <span v-else class="ax-li-add">＋</span>
                </button>
              </template>
            </template>
            <div v-if="leftGroups.length === 0" class="ax-none">該当する品目がありません</div>
          </div>
        </div>

        <!-- 右：グループ設定 -->
        <div class="ax-pane ax-right">
          <div class="ax-addrow">
            <input v-model="newGroupName" type="text" maxlength="20"
                   :placeholder="activeName + 'を追加'" class="ax-mini-input"
                   @keyup.enter="onAddGroup" />
            <button class="ax-add-btn" @click="onAddGroup">＋</button>
          </div>
          <div class="ax-scroll">
            <div v-for="g in displayGroups" :key="g"
                 :class="['ax-group', { on: targetGroup === g }]">
              <div class="ax-group-head" @click="selectGroup(g)">
                <span class="ax-radio">{{ targetGroup === g ? '●' : '○' }}</span>
                <span class="ax-group-name">{{ g }}</span>
                <span class="ax-group-count">{{ groupCount[g] || 0 }}</span>
              </div>
              <template v-if="targetGroup === g">
                <!-- 選択中グループの操作バー（ヘッダーを狭くしない） -->
                <div class="ax-group-actions">
                  <template v-if="definedIndex(g) >= 0">
                    <button class="ax-abtn" :disabled="definedIndex(g) === 0" @click.stop="moveTop(g)">⤒先頭</button>
                    <button class="ax-abtn" :disabled="definedIndex(g) === 0" @click.stop="move(g, -1)">▲上</button>
                    <button class="ax-abtn" :disabled="definedIndex(g) === defined.length - 1" @click.stop="move(g, 1)">▼下</button>
                  </template>
                  <button class="ax-abtn" @click.stop="onRenameGroup(g)">✎名前</button>
                  <button class="ax-abtn danger" @click.stop="onDeleteGroup(g)">🗑削除</button>
                </div>
                <div class="ax-members">
                <template v-for="item in config.order" :key="item">
                  <span v-if="itemGroups(item).includes(g)" class="ax-member">
                    {{ item }}<button class="ax-member-x" @click="removeFrom(item, g)">×</button>
                  </span>
                </template>
                <span v-if="(groupCount[g] || 0) === 0" class="ax-member-empty">左の品目をタップして追加</span>
                </div>
              </template>
            </div>
            <div v-if="displayGroups.length === 0" class="ax-guide">
              <div class="ax-guide-arrow">☝️</div>
              <div class="ax-guide-title">まずはグループを設定しましょう</div>
              <div class="ax-guide-desc">上の欄に「{{ activeName }}」の名前を入れて「＋」で追加します。</div>
              <div class="ax-guide-egtitle">例</div>
              <div class="ax-guide-eg">食材　酒類　消耗品</div>
              <div class="ax-guide-eg">キッチン冷凍庫　ホール冷蔵庫</div>
              <div class="ax-guide-eg">八百屋　肉屋　酒屋</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 振り分け先未選択の案内トースト -->
    <div v-if="flash" class="ax-flash">{{ flash }}</div>

    <!-- 複数所属の確認 -->
    <div v-if="pendingItem" class="ax-confirm-overlay" @click.self="pendingItem = null">
      <div class="ax-confirm">
        <div class="ax-confirm-title">複数の場所に割り当て</div>
        <div class="ax-confirm-body">
          「{{ pendingItem }}」は既に
          <b>{{ itemGroups(pendingItem).join('、') }}</b>
          に割り当てられています。<br>
          <b>{{ targetGroup }}</b> にも追加しますか？（複数の場所に置けます）
        </div>
        <div class="ax-confirm-actions">
          <button class="ax-cbtn" @click="pendingItem = null">キャンセル</button>
          <button class="ax-cbtn primary" @click="confirmMulti">追加する</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ax-overlay { position: fixed; inset: 0; z-index: 2100; background: #f5f6f8; display: flex; flex-direction: column; }
.ax-header { display: flex; align-items: center; padding: 12px 14px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.ax-back { background: none; border: none; color: #2563eb; font-size: 16px; cursor: pointer; padding: 4px 6px; }
.ax-title { font-weight: 700; font-size: 15px; flex: 1; text-align: center; }
.ax-spacer { width: 52px; }

.ax-empty { text-align: center; padding: 56px 24px; color: #6b7280; }
.ax-empty-icon { font-size: 44px; margin-bottom: 12px; }
.ax-empty-title { font-weight: 700; color: #374151; margin-bottom: 6px; }
.ax-empty-desc { font-size: 13px; line-height: 1.6; }

.ax-tabs { display: flex; gap: 6px; padding: 10px 12px 0; }
.ax-tab { flex: 1; padding: 8px; border: 1.5px solid #d1d5db; background: #fff; border-radius: 9px; font-weight: 700; font-size: 13px; color: #6b7280; cursor: pointer; }
.ax-tab.on { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

.ax-warn { display: flex; gap: 10px; align-items: flex-start; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; margin: 10px 12px 0; padding: 10px 12px; }
.ax-warn-icon { font-size: 18px; flex-shrink: 0; }
.ax-warn-title { font-size: 13px; font-weight: 700; color: #92400e; }
.ax-warn-desc { font-size: 12px; color: #b45309; margin-top: 2px; line-height: 1.5; }

.ax-hint { font-size: 12px; color: #6b7280; padding: 8px 12px; line-height: 1.5; }

.ax-guide { padding: 20px 14px; text-align: center; }
.ax-guide-arrow { font-size: 22px; }
.ax-guide-title { font-size: 15px; font-weight: 800; color: #2563eb; margin-top: 6px; }
.ax-guide-desc { font-size: 12px; color: #6b7280; margin-top: 6px; line-height: 1.6; }
.ax-guide-egtitle { font-size: 11px; color: #cbd5e1; font-weight: 700; margin-top: 14px; }
.ax-guide-eg { font-size: 12px; color: #cbd5e1; margin-top: 4px; letter-spacing: 0.02em; }
.ax-target { color: #2563eb; }
.ax-target-none { color: #dc2626; }

.ax-split { flex: 1; display: flex; gap: 8px; padding: 0 8px 8px; min-height: 0; }
.ax-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #fff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; }
.ax-pane-tools, .ax-addrow { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #f0f1f3; }
.ax-mini-input { flex: 1; min-width: 0; border: 1.5px solid #d1d5db; border-radius: 8px; padding: 7px 9px; font-size: 13px; outline: none; }
.ax-mini-input:focus { border-color: #2563eb; }
.ax-mini { flex-shrink: 0; border: 1.5px solid #d1d5db; background: #fff; border-radius: 8px; padding: 6px 8px; font-size: 11px; color: #4b5563; cursor: pointer; white-space: nowrap; }
.ax-mini.on { border-color: #2563eb; color: #2563eb; background: #eff6ff; }
.ax-add-btn { flex-shrink: 0; border: none; background: #2563eb; color: #fff; font-weight: 700; border-radius: 8px; padding: 0 14px; font-size: 16px; cursor: pointer; }
.ax-cat-copy { flex-shrink: 0; border: 1px solid #bfdbfe; background: #eff6ff; color: #2563eb; font-size: 10px; font-weight: 700; border-radius: 7px; padding: 3px 7px; cursor: pointer; }

.ax-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }

.ax-cat-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #f8fafc; border-bottom: 1px solid #eef0f2; position: sticky; top: 0; cursor: pointer; }
.ax-cat-arrow { font-size: 10px; color: #9ca3af; }
.ax-cat-name { flex: 1; font-size: 12px; font-weight: 700; color: #374151; word-break: break-all; }
.ax-cat-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.ax-cat-count { font-size: 11px; color: #9ca3af; }
.ax-cat-count strong { color: #2563eb; font-weight: 700; }

.ax-li { width: 100%; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: none; border-bottom: 1px solid #f3f4f6; background: #fff; cursor: pointer; text-align: left; }
.ax-li.assigned { background: #f3f4f6; color: #9ca3af; }
.ax-li.disabled { opacity: 0.7; }
.ax-li-name { flex: 1; font-size: 13px; color: inherit; word-break: break-all; }
.ax-li-add { color: #2563eb; font-weight: 700; }
/* 振り分け先は品目名の右で縦積み（品目名は中央揃え） */
.ax-li-tags { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.ax-li-tag { font-size: 10px; font-weight: 700; color: #2563eb; background: #eff6ff; border-radius: 6px; padding: 1px 6px; white-space: nowrap; }

.ax-group { border-bottom: 1px solid #f0f1f3; }
.ax-group.on { background: #eff6ff; }
.ax-group-head { display: flex; align-items: center; gap: 6px; padding: 9px 10px; cursor: pointer; }
.ax-radio { font-size: 12px; color: #2563eb; }
.ax-group-name { flex: 1; font-size: 13px; font-weight: 700; color: #374151; word-break: break-all; }
.ax-group-count { font-size: 11px; color: #9ca3af; }
.ax-group-actions { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 10px 8px; }
.ax-abtn { border: 1px solid #d1d5db; background: #fff; border-radius: 8px; font-size: 11px; color: #4b5563; cursor: pointer; padding: 5px 8px; white-space: nowrap; }
.ax-abtn:disabled { opacity: 0.3; cursor: default; }
.ax-abtn.danger { color: #dc2626; border-color: #fecaca; }
.ax-gbtn.danger { filter: grayscale(0.2); }
.ax-members { padding: 4px 10px 10px; display: flex; flex-wrap: wrap; gap: 4px; }
.ax-member { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 2px 4px 2px 8px; color: #374151; }
.ax-member-x { border: none; background: none; color: #9ca3af; font-size: 13px; cursor: pointer; padding: 0 2px; }
.ax-member-empty { font-size: 11px; color: #9ca3af; }

.ax-none { padding: 20px; text-align: center; color: #9ca3af; font-size: 12px; }

.ax-flash { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2200; background: #1f2937; color: #fff; font-size: 13px; font-weight: 700; padding: 10px 16px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); max-width: 90%; text-align: center; }

.ax-confirm-overlay { position: fixed; inset: 0; z-index: 2200; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ax-confirm { background: #fff; border-radius: 14px; padding: 18px; max-width: 340px; width: 100%; }
.ax-confirm-title { font-weight: 700; font-size: 15px; margin-bottom: 8px; }
.ax-confirm-body { font-size: 13px; color: #4b5563; line-height: 1.7; margin-bottom: 16px; }
.ax-confirm-actions { display: flex; gap: 10px; }
.ax-cbtn { flex: 1; padding: 10px; border: 1.5px solid #d1d5db; background: #fff; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; }
.ax-cbtn.primary { border-color: #2563eb; background: #2563eb; color: #fff; }
</style>
