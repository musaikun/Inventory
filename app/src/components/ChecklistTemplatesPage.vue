<script setup>
/**
 * チェック表（項目の並びのひな形）。業務の追加とは別の入口（User決定 2026-11-07・キャンバス「業務の追加」②）。
 * - ひな形を作る・直す（名前と項目）。作るのは「やることを作る」人、直す・消すのは作った人と管理者
 * - 「このチェック表で業務を追加」→ 追加の画面にこの項目を付けて開く
 * - ★ お気に入り（項目のない、業務ごとのひな形）も同じ場所に並べる。押すとその中身で追加の画面へ
 */
import { askConfirm } from '../composables/askConfirm.js'
import LineIcon from './LineIcon.vue'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { templates, checklistTemplates, saveChecklistTemplate, removeTemplate, canAddTemplate, canEditTemplate, templateSummary, pullTemplates, KIND_ICON } from '../composables/useTemplates.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { useListDragReorder } from '../composables/useListDragReorder.js'

const emit = defineEmits(['close', 'use-checklist', 'use-template'])
onMounted(() => { pullTemplates() })

const favorites = computed(() => templates.value.filter(t => !(t.kind === 'checklist' && t.data?.items?.length)))

// 直す（null = 閉じている。id が空なら新しく作る）
const edit = ref(null)   // { id, name, items: [{ id, text }] }
const draft = ref('')
const err = ref(''), busy = ref(false)
const _iid = () => 'i_' + Math.random().toString(36).slice(2, 10)
// 開いたときの中身（閉じるときに、変えたかどうかを見る）
let _snap = ''
const _key = e => JSON.stringify({ n: e.name, i: e.items.map(x => x.text) })
function _open(e) { edit.value = e; _snap = _key(e); draft.value = ''; err.value = '' }
function openNew() { _open({ id: '', name: '', items: [] }) }
function openEdit(t) { _open({ id: t.id, name: t.name, items: (t.data?.items ?? []).map(x => ({ id: x.id || _iid(), text: x.text })) }) }
const dirty = () => !!edit.value && (_key(edit.value) !== _snap || !!draft.value.trim())
/** 閉じる。作りかけ・直しかけなら確かめる（外を触っただけで消えないように・User 2026-11-08） */
async function closeEdit() {
  itemDrag.cleanup()
  if (dirty() && !await askConfirm({ title: edit.value.id ? '直した内容を保存せずに閉じますか？' : '作りかけのチェック表を捨てて閉じますか？', ok: '閉じる', cancel: '続ける', danger: true })) return false
  edit.value = null
  return true
}
// 項目の書き直し: 空にしたら消す（User 2026-11-08）
function fixItem(i) {
  const it = edit.value.items[i]
  it.text = it.text.trim().slice(0, 100)
  if (!it.text) edit.value.items.splice(i, 1)
}
const editable = computed(() => !edit.value?.id || canEditTemplate(templates.value.find(t => t.id === edit.value.id)))
function addItem() {
  const t = draft.value.trim()
  if (!t || edit.value.items.length >= 50) return
  edit.value.items.push({ id: _iid(), text: t.slice(0, 100) })
  draft.value = ''
}
// 並べ替え: ⋮⋮ を長押しして運ぶ（導線の順番と同じ操作。User 2026-11-08）。上下キーでも動く
const itemsEl = ref(null)
const itemDrag = useListDragReorder({
  listEl: itemsEl,
  rowSelector: '.ct-row',
  keyAttr: 'id',
  currentOrder: () => edit.value?.items.map(x => x.id) ?? [],
  commitOrder: ids => {
    const by = new Map(edit.value.items.map(x => [x.id, x]))
    edit.value.items = ids.map(id => by.get(id)).filter(Boolean)
  },
})
// 書き直し中の入力欄を押しても掴まない（つまみだけ）
function onItemDown(e) { if (e.target.closest?.('.ct-handle')) itemDrag.onDown(e) }
async function save() {
  if (busy.value) return
  if (draft.value.trim()) addItem()
  busy.value = true; err.value = ''
  try {
    const items = edit.value.items.map(x => ({ ...x, text: x.text.trim() })).filter(x => x.text)
    const t = await saveChecklistTemplate(edit.value.id || null, edit.value.name, items)
    edit.value = null
    return t
  } catch (e) { err.value = e?.message || '保存できませんでした' } finally { busy.value = false }
}
async function saveAndUse() {
  const t = editable.value ? await save() : templates.value.find(x => x.id === edit.value.id)
  if (t) emit('use-checklist', t)
}
async function remove() {
  const id = edit.value?.id
  if (!id || !await askConfirm({ title: 'このチェック表を消しますか？', ok: '消す', danger: true })) return
  try { await removeTemplate(id); edit.value = null } catch (e) { err.value = e?.message || '消せませんでした' }
}

onUnmounted(() => itemDrag.cleanup())
onUnmounted(registerInnerLayerCloser(() => { if (edit.value) { closeEdit(); return true } emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="ct" role="dialog" aria-label="チェック表">
      <header class="ct-h">
        <button type="button" class="ct-back" aria-label="もどる" @click="emit('close')">‹</button>
        <h2>チェック表</h2>
      </header>
      <div class="ct-list">
        <p v-if="!checklistTemplates.length && !favorites.length" class="ct-empty">まだありません</p>
        <button v-for="t in checklistTemplates" :key="t.id" type="button" class="ct-card" @click="openEdit(t)">
          <span class="ct-t"><b>{{ t.name }}</b><small>{{ t.data.items.length }}項目</small></span>
          <span class="ct-p">{{ t.data.items.map(x => x.text).join('・') }}</span>
        </button>
        <template v-if="favorites.length">
          <span class="ct-sec"><LineIcon name="star" /> お気に入り</span>
          <button v-for="t in favorites" :key="t.id" type="button" class="ct-card fav" @click="emit('use-template', t)">
            <span class="ct-t"><b><LineIcon :name="KIND_ICON[t.kind]" size="1em" /> {{ t.name }}</b></span>
            <span class="ct-p">{{ templateSummary(t) }}</span>
          </button>
        </template>
      </div>
      <button v-if="canAddTemplate" type="button" class="ct-fab" @click="openNew"><LineIcon name="plus" /> チェック表を作る</button>
    </div>

    <div v-if="edit" class="ct-bg" @click.self="closeEdit">
      <form class="ct-sh" aria-label="チェック表を直す" @submit.prevent="addItem">
        <div class="ct-sh-h">
          <b>{{ edit.id ? 'チェック表を直す' : 'チェック表を作る' }}</b>
          <button type="button" aria-label="閉じる" @click="closeEdit">✕</button>
        </div>
        <!-- 名前は入力欄と分かる形に（見出しのような枠なしだと一瞬わからない・User 2026-11-07） -->
        <label class="ct-nm"><span>チェック表の名前</span>
          <input v-model="edit.name" type="text" maxlength="60" aria-label="チェック表の名前" placeholder="例：閉店チェック" :disabled="!editable" />
        </label>
        <ol ref="itemsEl" class="ct-items"
          @pointerdown="onItemDown" @pointermove="itemDrag.onMove" @pointerup="itemDrag.onUp"
          @pointercancel="itemDrag.onUp" @lostpointercapture="itemDrag.onUp" @touchmove="itemDrag.onTouchMove">
          <li v-for="(it, i) in edit.items" :key="it.id" :data-id="it.id" class="ct-row">
            <button v-if="editable && edit.items.length > 1" type="button" class="ct-handle" :aria-label="`${it.text} を運ぶ。現在 ${i + 1} 番目。上下矢印キーで移動`" @keydown="itemDrag.onKeydown($event, it.id)">⋮⋮</button>
            <!-- 押して書き直せる（空にすると消える） -->
            <input v-if="editable" v-model="it.text" type="text" maxlength="100" class="ct-it" :aria-label="`項目${i + 1}`" @blur="fixItem(i)" @keydown.enter.prevent="$event.target.blur()" />
            <span v-else>{{ it.text }}</span>
            <template v-if="editable">
              <button type="button" :aria-label="`${it.text}を消す`" @click="edit.items.splice(i, 1)">✕</button>
            </template>
          </li>
        </ol>
        <div v-if="editable" class="ct-add">
          <input v-model="draft" type="text" maxlength="100" aria-label="項目" placeholder="項目" />
          <button type="submit" :disabled="!draft.trim()" aria-label="項目を足す"><LineIcon name="plus" /></button>
        </div>
        <p v-if="err" class="ct-err" role="alert">{{ err }}</p>
        <div class="ct-acts">
          <button v-if="edit.id && editable" type="button" class="del" @click="remove">消す</button>
          <button v-if="editable" type="button" class="sub" :disabled="busy" @click="save">保存</button>
          <button type="button" class="main" :disabled="busy || !edit.name.trim() || !(edit.items.length || draft.trim())" @click="saveAndUse">このチェック表で業務を追加</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.ct { position: fixed; inset: 0; z-index: 110; display: flex; flex-direction: column; background: #eef5f7; max-width: 600px; margin: 0 auto; }
.ct-h { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--surface, #fff); border-bottom: 1px solid #e3ecef; }
.ct-h h2 { margin: 0; font-size: 19px; }
.ct-back { width: 40px; height: 40px; border: none; border-radius: 12px; background: #eef4f6; font: inherit; font-size: 22px; font-weight: 800; color: var(--text); cursor: pointer; }
.ct-list { flex: 1; overflow-y: auto; padding: 12px 12px 100px; display: flex; flex-direction: column; gap: 10px; }
.ct-empty { margin: 48px 0; text-align: center; font-weight: 800; color: var(--text-muted); }
.ct-card { display: flex; flex-direction: column; gap: 4px; padding: 14px; border: none; border-radius: 18px; background: var(--surface, #fff); font: inherit; text-align: left; color: var(--text); cursor: pointer; }
.ct-t { display: flex; align-items: center; gap: 8px; }
.ct-t b { flex: 1; font-size: 15px; display: inline-flex; align-items: center; gap: 6px; }
.ct-t small { font-size: 12px; font-weight: 800; color: var(--text-muted); }
.ct-p { font-size: 12.5px; font-weight: 700; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-sec { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; font-weight: 900; color: #a16207; }
.ct-card.fav { background: #fffdf5; }
.ct-fab { position: absolute; right: 16px; bottom: calc(22px + env(safe-area-inset-bottom)); height: 52px; padding: 0 20px; border: none; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, #0e7490, #0b3b48); color: #fff; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; box-shadow: 0 8px 20px rgba(14,116,144,.4); }
.ct-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.45); display: flex; align-items: flex-end; justify-content: center; }
.ct-sh { width: 100%; max-width: 600px; box-sizing: border-box; max-height: 85dvh; overflow-y: auto; background: var(--surface, #fff); border-radius: 22px 22px 0 0; padding: 12px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
.ct-sh-h { display: flex; align-items: center; gap: 6px; }
.ct-sh-h b { flex: 1; min-width: 0; font-size: 16px; font-weight: 900; }
.ct-nm { display: grid; gap: 4px; }
.ct-nm span { font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.ct-nm input { min-height: 48px; border: 1.5px solid #b9d3da; border-radius: 12px; padding: 0 12px; font: inherit; font-size: 16px; font-weight: 800; color: var(--text); background: #f7fbfc; box-sizing: border-box; width: 100%; }
.ct-nm input:focus { outline: none; border-color: var(--primary, #0e7490); background: var(--surface, #fff); box-shadow: 0 0 0 3px rgba(14,116,144,.15); }
.ct-nm input::placeholder { color: #94a3b8; font-weight: 600; }
.ct-nm input:disabled { background: transparent; border-color: transparent; padding: 0; }
.ct-sh-h input:focus { outline: none; }
.ct-sh-h button { width: 40px; height: 40px; border: none; background: none; font-size: 16px; color: var(--text-muted); cursor: pointer; }
.ct-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ct-items li { display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 6px 0 12px; border-radius: 12px; background: #f3f8fa; font-size: 14px; font-weight: 700; }
.ct-items li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.ct-items li button { min-width: 36px; min-height: 36px; border: none; background: none; color: var(--text-muted); font-size: 14px; cursor: pointer; }
.ct-items li button:disabled { opacity: .3; }
.ct-items li.ct-row { padding-left: 0; }
.ct-items li.ct-row.holding { box-shadow: inset 0 0 0 1.5px var(--primary, #0e7490); }
.ct-items li.ct-row.drag { background: #fff; box-shadow: 0 8px 20px rgba(6,34,43,.18); position: relative; z-index: 2; }
.ct-items li .ct-handle { flex: none; width: 36px; min-height: 44px; color: #8aa0a8; font-size: 15px; letter-spacing: -3px; cursor: grab; touch-action: none; }
.ct-items li.ct-row > .ct-it:first-child, .ct-items li.ct-row > span:first-child { margin-left: 6px; }
.ct-it { flex: 1; min-width: 0; min-height: 36px; border: 1.5px solid transparent; border-radius: 8px; background: transparent; padding: 0 6px; margin-left: -6px; font: inherit; font-size: 14px; font-weight: 700; color: var(--text); }
.ct-it:focus { outline: none; border-color: var(--primary, #0e7490); background: var(--surface, #fff); }
.ct-add { display: flex; gap: 6px; }
.ct-add input { flex: 1; min-width: 0; min-height: 44px; border: 1.5px solid #d6e6ea; border-radius: 12px; padding: 0 12px; font: inherit; font-size: 15px; color: var(--text); background: var(--surface); }
.ct-add button { width: 44px; min-height: 44px; border: none; border-radius: 12px; background: #e6f5f8; color: #0b5f73; cursor: pointer; display: grid; place-items: center; }
.ct-add button:disabled { opacity: .4; }
.ct-err { margin: 0; font-size: 12.5px; font-weight: 700; color: #b91c1c; }
.ct-acts { display: flex; gap: 8px; flex-wrap: wrap; }
.ct-acts button { min-height: 48px; border: none; border-radius: 14px; font: inherit; font-size: 14.5px; font-weight: 900; cursor: pointer; padding: 0 14px; }
.ct-acts .del { background: none; color: #b91c1c; }
.ct-acts .sub { background: #eef4f6; color: #3d545d; }
.ct-acts .main { flex: 1; background: linear-gradient(135deg, #0e7490, #0b3b48); color: #fff; }
.ct-acts button:disabled { opacity: .45; }
</style>
