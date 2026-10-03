<script setup>
/**
 * 在庫タブの「非表示」の絞り込み（User決定 2026-10-03：管理の「非表示・除外した品目」を在庫タブへ）。
 * - 非表示の品目を「最後に隠した順」で並べ、その場で戻せる（誤って隠したものを遡って探す）
 * - 直近の取込で品目にしなかった行は、最後に1行の入口から開いて「品目にする」
 */
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { sortHiddenByRecent, hiddenAtLabel } from '../utils/hiddenItems.js'

const props = defineProps({ editable: { type: Boolean, default: true } })

const { config, unhideItem, addItem, dropImportExcluded } = useConfig()

const rows = computed(() => {
  const at = config.hiddenAt ?? {}
  const auto = new Set(config.hiddenAuto ?? [])
  return sortHiddenByRecent(config.hiddenItems ?? [], at).map(name => ({
    name, at: hiddenAtLabel(at[name]), auto: auto.has(name),
  }))
})

const excluded = computed(() => config.importExcluded ?? null)
const excludedAt = computed(() => hiddenAtLabel(excluded.value?.at))
const excludedOpen = ref(false)
const orderSet = computed(() => new Set(config.order ?? []))
const msg = ref('')
// 除外した行を品目にする。上限や同名で入らなければ理由を出す（黙って何も起きないのを避ける）
function adopt(i) {
  const r = excluded.value?.rows?.[i]
  if (!r || !props.editable) return
  if (!addItem(r.name)) { msg.value = `「${r.name}」は追加できませんでした（品目数の上限か、同じ名前があります）`; return }
  dropImportExcluded(i)
  msg.value = `「${r.name}」を品目にしました`
}
</script>

<template>
  <div class="hl">
    <div v-if="!rows.length" class="hl-empty">非表示の品目はありません</div>
    <div v-for="r in rows" :key="r.name" class="hl-row">
      <span class="hl-main">
        <span class="hl-name">{{ r.name }}</span>
        <span class="hl-at">{{ r.at ? `${r.at} に非表示` : '非表示' }}<template v-if="r.auto">（自動）</template></span>
      </span>
      <button v-if="editable" type="button" class="hl-back" @click="unhideItem(r.name)">戻す</button>
    </div>

    <template v-if="excluded?.total">
      <button
        type="button" class="hl-excl" :aria-expanded="excludedOpen ? 'true' : 'false'"
        @click="excludedOpen = !excludedOpen"
      >
        <span>取込で除外した行 {{ excluded.total }}件<small>品目にしなかった行</small></span>
        <b>{{ excludedOpen ? '▲' : '▼' }}</b>
      </button>
      <div v-if="excludedOpen" class="hl-excl-body">
        <div class="hl-excl-head">
          直近の取込（{{ excludedAt }}）で品目にしなかった行です。必要なものは「品目にする」で追加できます
          （名前だけで入るので、単位や入数は「要確認」から埋めてください）。
        </div>
        <div v-if="msg" class="hl-msg" role="status">{{ msg }}</div>
        <div v-for="(r, i) in excluded.rows" :key="i + r.name" class="hl-row">
          <span class="hl-main">
            <span class="hl-name">{{ r.name }}</span>
            <span class="hl-at">{{ r.reason }}</span>
          </span>
          <span v-if="orderSet.has(r.name)" class="hl-done">登録済み</span>
          <button v-else-if="editable" type="button" class="hl-back" @click="adopt(i)">品目にする</button>
        </div>
        <div v-if="excluded.total > excluded.rows.length" class="hl-at hl-more">ほか {{ excluded.total - excluded.rows.length }}行</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hl { margin: 0 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.hl-empty { padding: 18px 12px; text-align: center; font-size: 13px; color: var(--text-muted); }
.hl-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-top: 1px solid var(--border); }
.hl-row:first-child { border-top: none; }
.hl-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.hl-name { font-size: 14px; font-weight: 700; color: var(--text); overflow-wrap: anywhere; }
.hl-at { font-size: 11px; color: var(--text-muted); }
.hl-back {
  flex: none; min-height: 36px; padding: 4px 12px; border-radius: 9px; cursor: pointer;
  border: 1.5px solid var(--primary); background: var(--surface); color: var(--primary); font-size: 12.5px; font-weight: 800;
}
.hl-done { flex: none; font-size: 11px; font-weight: 700; color: var(--text-muted); }
.hl-excl {
  width: 100%; display: flex; align-items: center; gap: 8px; padding: 11px 12px; border: none; border-top: 1px solid var(--border);
  background: var(--bg); color: var(--text); font: inherit; font-size: 13px; font-weight: 700; text-align: left; cursor: pointer;
}
.hl-excl span { flex: 1; display: flex; flex-direction: column; }
.hl-excl small { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.hl-excl b { color: var(--text-muted); font-size: 11px; }
.hl-excl-body { border-top: 1px solid var(--border); background: var(--bg); }
.hl-excl-body .hl-row { background: var(--surface); }
.hl-excl-head { font-size: 11.5px; color: var(--text-muted); line-height: 1.6; padding: 8px 12px; }
.hl-msg { margin: 0 12px 8px; font-size: 12px; font-weight: 700; color: var(--text); background: var(--surface); border-radius: 8px; padding: 6px 8px; }
.hl-more { padding: 8px 12px; }
</style>
