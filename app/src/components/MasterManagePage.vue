<script setup>
import { can, denyMessage } from '../composables/useAuth.js'
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { shopCode } from '../composables/useStore.js'

// embedded: ホームの「設定」タブに置くとき（以前の「管理」・User決定 2026-10-14）。
// 見出しと戻るを出さず、#extra（発注の設定・各種設定など）の下に品目の一括削除を置く。
// 取り込む・書き出すはホームへ移した（DataPort.vue）
const props = defineProps({
  embedded: { type: Boolean, default: false },
  // 完了していない棚卸・発注（中断中＋取り戻せる破棄）の件数。一括削除で一緒に消える
  unfinishedCount: { type: Number, default: 0 },
})
const emit = defineEmits(['back', 'clear-master'])

const { itemCount } = useConfig()

// ── ヘルプ（「?」で開閉） ─────────────────────────
const HELP = {
  delete: '登録済みの品目をすべて削除します。中断中・破棄した棚卸と発注（完了していないもの）も一緒に消え、元に戻せません。完了した記録は残ります。取り消せません。誤操作防止のため店舗コードの入力が必要です。分類名やグループ定義・振り分けの記憶は既定で残ります。',
}
const activeHelp = ref('')
function toggleHelp(k) { activeHelp.value = activeHelp.value === k ? '' : k }

// ── 一括削除（店舗コード入力ゲート）─────────────────────────────
const delCode = ref('')
const resetAssign = ref(false)   // 振り分け（品目→分類先の割り当て）の記憶も消すか
const canDelete = computed(() => !!shopCode.value && delCode.value.trim().toUpperCase() === shopCode.value)
function onClear() {
  if (!can('item.purge')) { window.alert(denyMessage('item.purge')); return }
  if (!canDelete.value) return
  const note = resetAssign.value
    ? '\n振り分け（分類先の割り当て）の記憶も消去します。'
    : '\n（軸の名前・グループ定義・振り分けの記憶は残り、同じ品目を再登録すれば割り当ては復活します）'
  const sessNote = props.unfinishedCount > 0
    ? `\n中断中・破棄した棚卸と発注（${props.unfinishedCount}件）も消え、元に戻せなくなります。`
    : ''
  if (!confirm(`登録済みの品目 ${itemCount.value} 件をすべて削除します。${note}${sessNote}\nこの操作は取り消せません。本当に削除しますか？`)) return
  emit('clear-master', { resetAssignments: resetAssign.value })
  delCode.value = ''
  resetAssign.value = false
}
</script>

<template>
  <div :class="['mp', { embedded }]">
    <header v-if="!embedded" class="mp-header">
      <button class="mp-back" @click="emit('back')">‹ 戻る</button>
      <span class="mp-title">🗂 データ管理</span>
      <span class="mp-count">{{ itemCount }}件</span>
    </header>

    <div class="mp-scroll">
      <!-- 設定タブの項目（発注の設定・各種設定など） -->
      <slot name="extra" />

      <!-- 一括削除（危険操作・店舗コードゲート）。いちばん下 -->
      <div v-if="itemCount > 0 && can('item.purge')" class="mm-block danger">
        <div class="mm-block-head">
          <span class="mm-block-title danger">品目マスタを一括削除</span>
          <button class="mm-help-btn danger" :class="{ on: activeHelp === 'delete' }" @click="toggleHelp('delete')">?</button>
        </div>
        <div v-if="activeHelp === 'delete'" class="mm-help">{{ HELP.delete }}</div>
        <div class="mm-block-sub">
          登録済みの品目をすべて削除します（軸の名前・グループ定義は残ります）。中断中・破棄した棚卸と発注も一緒に消えます。取り消せません。<br>
          削除するには店舗コード <b>{{ shopCode || '（未取得）' }}</b> を入力してください。
        </div>
        <input class="mm-del-input" v-model="delCode" placeholder="店舗コードを入力" autocapitalize="characters" />
        <label class="mm-del-reset"><input type="checkbox" v-model="resetAssign" />振り分け（分類先の割り当て）の記憶も消す</label>
        <button class="mm-del-btn" :disabled="!canDelete" @click="onClear">全品目を削除</button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.mp { min-height: 100vh; background: #f6fafb; }
.mp.embedded { min-height: 0; padding-bottom: 12px; }
.mp-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #d6e6ea;
}
.mp-back { border: none; background: none; color: var(--primary, #0e7490); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.mp-title { font-size: 16px; font-weight: 800; color: #12303a; }
.mp-count { margin-left: auto; font-size: 13px; font-weight: 800; color: var(--primary, #0e7490); }
.mp-scroll { padding: 14px; max-width: 620px; margin: 0 auto; }

.mm-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #d6e6ea; border-radius: 12px;
  padding: 14px; margin-bottom: 12px; cursor: pointer; text-align: left;
}
.mm-row:active { background: #edf5f7; }
.mm-row-ico { font-size: 20px; }
.mm-row-body { flex: 1; min-width: 0; }
.mm-row-title { display: block; font-size: 15px; font-weight: 700; color: #1f3d45; }
.mm-row-sub { display: block; font-size: 12px; color: #7d969c; margin-top: 2px; }
.mm-row-arrow { color: #bfd6dc; font-size: 18px; }

.mm-row-wrap { margin-bottom: 12px; }
.mm-row-wrap .mm-row { margin-bottom: 0; }

/* 同じ用途の行は1枚のカードにまとめ、区切り線だけで分ける */
.mm-card {
  background: #fff; border: 1px solid #d6e6ea; border-radius: 12px;
  overflow: hidden; margin-bottom: 12px;
}
.mm-card .mm-row-wrap { margin-bottom: 0; }
.mm-card .mm-row-wrap + .mm-row-wrap { border-top: 1px solid #edf5f7; }
.mm-card .mm-row { border: none; border-radius: 0; background: transparent; }
.mm-card .mm-help { margin: 0 14px 12px; }

.mm-tmpl-link {
  display: block; margin-top: 8px; border: none; background: none;
  color: var(--primary, #0e7490); font-size: 12px; font-weight: 700;
  text-decoration: underline; cursor: pointer; padding: 0;
}

.mm-rec-back { position: fixed; inset: 0; z-index: 70; background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; padding: 18px; }
.mm-rec { background: var(--surface); border-radius: 14px; padding: 16px; width: 100%; max-width: 380px; }
.mm-rec-t { font-size: 15px; font-weight: 800; color: var(--text); margin-bottom: 6px; }
.mm-rec-n { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }
.mm-rec-f { display: block; font-weight: 700; color: var(--text); }
.mm-rec-in { width: 100%; border: 1.5px solid var(--border); border-radius: 10px;
  padding: 10px 12px; font-size: 14px; margin-bottom: 12px; }
.mm-rec-btns { display: flex; gap: 10px; }
.mm-rec-btns .btn { flex: 1; }
.mm-rec-done { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 70;
  background: var(--primary); color: #fff; border-radius: 20px; padding: 8px 16px;
  font-size: 12px; font-weight: 800; }

.mm-hidden-file { display: none; }


.mm-help-btn {
  flex-shrink: 0;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: auto;
  border: 1px solid #bfd6dc; border-radius: 50%;
  background: #fff; color: #7d969c;
  font-size: 12px; font-weight: 800; line-height: 1;
  cursor: pointer;
}
.mm-help-btn.on { background: var(--primary, #0e7490); color: #fff; border-color: var(--primary, #0e7490); }
.mm-help-btn.danger.on { background: #dc2626; border-color: #dc2626; }

.mm-help {
  font-size: 12px; line-height: 1.7; color: #3d5a62;
  background: #f6fafb; border: 1px solid #d6e6ea;
  border-left: 3px solid var(--primary, #0e7490);
  border-radius: 8px; padding: 9px 12px; margin: 8px 0 2px;
}

.mm-block { background: #fff; border: 1px solid #d6e6ea; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.mm-block.danger { border-color: #fecaca; }
.mm-block-head { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: none; padding: 0; }
.mm-toggle { cursor: pointer; }
.mm-block-title { font-size: 14px; font-weight: 800; color: #1f3d45; }
.mm-block-title.danger { color: #dc2626; }
.mm-block-note { margin-left: auto; font-size: 12px; font-weight: 700; color: #7d969c; }
.mm-block-sub { font-size: 12px; color: #4c6a72; margin: 8px 0; line-height: 1.6; }
.mm-empty { font-size: 12px; color: #7d969c; margin-top: 8px; }

/* 取り込む / 書き出す の種類を選ぶシート */
.mm-pick-back { position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-end; justify-content: center; }
.mm-pick { width: 100%; max-width: 560px; max-height: 84vh; overflow-y: auto; background: #fff; border-radius: 18px 18px 0 0; padding: 4px 12px 22px; box-shadow: 0 -8px 30px rgba(0,0,0,0.25); animation: mm-pick-up 0.22s cubic-bezier(0.22,0.8,0.28,1); }
@keyframes mm-pick-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.mm-pick-head { display: flex; align-items: center; gap: 10px; padding: 12px 4px 10px; }
.mm-pick-title { font-size: 15px; font-weight: 800; color: #12303a; }
.mm-pick-close { margin-left: auto; border: none; background: none; font-size: 18px; color: #7d969c; cursor: pointer; padding: 2px 6px; }
@media (prefers-reduced-motion: reduce) { .mm-pick { animation: none; } }


.mm-axis-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.mm-axis-label { font-size: 12px; font-weight: 800; color: #4c6a72; width: 58px; flex-shrink: 0; }
.mm-axis-input { flex: 1; min-width: 0; border: 1px solid #d6e6ea; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
.mm-axis-go { flex-shrink: 0; border: 1px solid var(--primary-border, #a5f3fc); background: #fff; color: var(--primary, #0e7490); border-radius: 8px; font-size: 12px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
.mm-axis-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 800; color: #12303a; }
.mm-axis-confirm { flex-shrink: 0; border: none; background: var(--primary, #0e7490); color: #fff; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 8px 16px; cursor: pointer; }
.mm-axis-confirm:disabled { background: #bfd6dc; cursor: not-allowed; }
.mm-axis-del { flex-shrink: 0; border: 1px solid #fecaca; background: #fff; color: #dc2626; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
.mm-axis-edit { flex-shrink: 0; border: 1px solid #d6e6ea; background: #fff; color: #4c6a72; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 6px 9px; cursor: pointer; }
.mm-axis-cancel { flex-shrink: 0; border: 1px solid #d6e6ea; background: #fff; color: #7d969c; border-radius: 8px; font-size: 16px; line-height: 1; padding: 6px 11px; cursor: pointer; }
.mm-axis-add { flex: 1; min-width: 0; border: 1px dashed var(--primary-border, #a5f3fc); background: #fff; color: var(--primary, #0e7490); border-radius: 8px; font-size: 13px; font-weight: 700; padding: 10px; cursor: pointer; }
/* ジャンルは名前も中身も編集できない。触れるものが無いことを、空白ではなく言葉で出す */
.mm-axis-fixed { flex-shrink: 0; font-size: 11px; font-weight: 700; color: #7d969c; background: #edf5f7; border: 1px solid #d6e6ea; border-radius: 7px; padding: 5px 9px; white-space: nowrap; }
.mm-axis-err { font-size: 12px; font-weight: 700; color: #dc2626; margin: 6px 0 0 66px; line-height: 1.5; }




.mm-preview { margin-top: 10px; }
.mm-page { position: fixed; inset: 0; z-index: 30; background: #f6fafb; overflow-y: auto; }
button.mm-stat { cursor: pointer; -webkit-tap-highlight-color: transparent; }
button.mm-stat:disabled { cursor: default; }

.mm-del-input { width: 100%; border: 1.5px solid #fecaca; border-radius: 8px; padding: 10px; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
.mm-del-reset { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4c6a72; margin-bottom: 10px; cursor: pointer; }
.mm-del-reset input { width: 16px; height: 16px; }
.mm-del-btn { width: 100%; border: none; border-radius: 10px; padding: 11px; background: #dc2626; color: #fff; font-size: 14px; font-weight: 800; cursor: pointer; }
.mm-del-btn:disabled { background: #fca5a5; cursor: not-allowed; }
</style>
