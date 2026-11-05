<script setup>
/**
 * ★ お気に入りの一覧（店で共有のひな形・User決定 2026-11-05・モック docs/mocks/task-create.html 2-3）。
 * 種類で絞る・「使う」で追加の画面を中身入りで開く・名前を直す・並べ替え・外す（作った人と管理者）
 */
import { ref, computed, onUnmounted } from 'vue'
import { templates, canEditTemplate, renameTemplate, removeTemplate, moveTemplate, KIND_ICON, templateSummary } from '../composables/useTemplates.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const emit = defineEmits(['close', 'use'])
const filter = ref('')   // '' | kind
const FILTERS = [['', 'すべて'], ['checklist', '📋'], ['routine', '🔁'], ['task', '📅'], ['progress', '⏳'], ['someday', '📥']]
const list = computed(() => templates.value.filter(t => !filter.value || t.kind === filter.value))
const editing = ref(''), draft = ref(''), err = ref(''), msg = ref('')
let _msgT = null
function say(m) { msg.value = m; clearTimeout(_msgT); _msgT = setTimeout(() => { msg.value = '' }, 2500) }
function startRename(t) { editing.value = t.id; draft.value = t.name; err.value = '' }
async function saveRename(t) {
  try { await renameTemplate(t.id, draft.value); editing.value = ''; say('名前を直しました') } catch (e) { err.value = e?.message || '直せませんでした' }
}
async function remove(t) {
  try { await removeTemplate(t.id); say(`「${t.name}」をお気に入りから外しました`) } catch (e) { err.value = e?.message || '外せませんでした' }
}
async function move(t, d) { try { await moveTemplate(t.id, d) } catch (e) { err.value = e?.message || '並べ替えられませんでした' } }
onUnmounted(() => clearTimeout(_msgT))
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="fv-bg" @click.self="emit('close')">
      <section class="fv" role="dialog" aria-label="お気に入り">
        <div class="fv-h"><b>★ お気に入り</b><button type="button" class="fv-x" @click="emit('close')">閉じる</button></div>
        <p class="fv-lead">店のみんなで使うひな形です。「使う」で中身の入った追加の画面が開きます（日付だけ選びます）。</p>
        <div class="fv-seg" role="radiogroup" aria-label="種類で絞る">
          <button v-for="f in FILTERS" :key="f[0]" type="button" role="radio" :aria-checked="filter === f[0]" :class="{ on: filter === f[0] }" @click="filter = f[0]">{{ f[1] }}</button>
        </div>
        <p v-if="err" class="fv-err" role="alert">{{ err }}</p>
        <p v-if="msg" class="fv-msg" role="status">{{ msg }}</p>
        <ul class="fv-list">
          <li v-for="(t, i) in list" :key="t.id" class="fv-i">
            <span class="fv-ic" :class="t.kind" aria-hidden="true">{{ KIND_ICON[t.kind] }}</span>
            <span class="fv-t">
              <template v-if="editing === t.id">
                <input v-model="draft" class="fv-in" aria-label="お気に入りの名前" maxlength="60" @keydown.enter.prevent="saveRename(t)" />
                <span class="fv-ed"><button type="button" @click="saveRename(t)">保存</button><button type="button" @click="editing = ''">やめる</button></span>
              </template>
              <template v-else>
                <b>{{ t.name }}</b><small>{{ templateSummary(t) }}</small>
                <span v-if="canEditTemplate(t)" class="fv-ed">
                  <button type="button" :disabled="i === 0 || filter !== ''" :aria-label="`${t.name}を上へ`" @click="move(t, -1)">↑</button>
                  <button type="button" @click="startRename(t)">名前</button>
                  <button type="button" class="ng" @click="remove(t)">外す</button>
                </span>
              </template>
            </span>
            <button type="button" class="fv-use" @click="emit('use', t)">使う</button>
          </li>
        </ul>
        <p v-if="!list.length" class="fv-empty">{{ filter ? 'この種類のお気に入りはありません' : 'まだお気に入りはありません。足すときに「お気に入りにも入れる」を選ぶか、やることのメニューから入れます' }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.fv-bg { position: fixed; inset: 0; z-index: 135; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.fv { width: 100%; max-width: 600px; max-height: 92dvh; overflow-y: auto; background: var(--surface, #fff); border-radius: 20px 20px 0 0; padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; box-sizing: border-box; }
.fv-h { display: flex; align-items: center; } .fv-h b { flex: 1; font-size: 16px; }
.fv-x { border: none; background: none; color: var(--text-muted); font-weight: 700; cursor: pointer; min-height: 40px; }
.fv-lead { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.6; }
.fv-seg { display: flex; flex-wrap: wrap; gap: 4px; }
.fv-seg button { border: 1px solid var(--border); background: var(--surface); border-radius: 9px; padding: 6px 11px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.fv-seg button.on { background: var(--primary, #0e7490); border-color: var(--primary, #0e7490); color: #fff; }
.fv-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.fv-i { display: grid; grid-template-columns: 30px 1fr auto; gap: 8px; align-items: center; border: 1px solid var(--border); border-radius: 12px; padding: 9px 10px; }
.fv-ic { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; background: #ecfeff; }
.fv-ic.checklist { background: #f5f3ff; } .fv-ic.routine { background: #f0fdfa; } .fv-ic.progress { background: #fffbeb; }
.fv-t { min-width: 0; display: grid; gap: 2px; }
.fv-t b { font-size: 14px; overflow-wrap: anywhere; } .fv-t small { font-size: 11px; color: var(--text-muted); font-weight: 700; }
.fv-ed { display: flex; gap: 4px; margin-top: 2px; }
.fv-ed button { border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 3px 8px; font: inherit; font-size: 11px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.fv-ed button.ng { color: #b91c1c; } .fv-ed button:disabled { opacity: .35; }
.fv-in { width: 100%; min-height: 36px; border: 1px solid var(--border); border-radius: 8px; padding: 0 8px; font: inherit; font-size: 14px; box-sizing: border-box; }
.fv-use { border: 1.5px solid var(--primary, #0e7490); background: var(--surface); color: var(--primary, #0e7490); border-radius: 9px; padding: 7px 11px; font: inherit; font-size: 12.5px; font-weight: 900; cursor: pointer; }
.fv-empty { margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.6; }
.fv-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.fv-msg { margin: 0; font-size: 12.5px; color: #15803d; font-weight: 700; }
</style>
