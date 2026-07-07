<script setup>
import { ref } from 'vue'
import { settingsSection } from '../composables/appMenuState.js'
import { downloadItemsCSV, downloadItemsTemplate } from '../utils/itemExport.js'

// context: 'home' | 'session'。context 固有の項目は slot で差し込む。
defineProps({ context: { type: String, default: 'home' } })

const open = ref(false)
function pick(section) { open.value = false; settingsSection.value = section }
function doExport()   { open.value = false; downloadItemsCSV() }
function doTemplate() { open.value = false; downloadItemsTemplate() }
</script>

<template>
  <div class="am-wrap">
    <button class="am-btn" :class="{ open }" title="メニュー" @click="open = !open">☰</button>
    <div v-if="open" class="am-backdrop" @click="open = false"></div>
    <div v-if="open" class="am-dropdown">
      <!-- 画面固有の項目（セッション一覧に戻る・バーコード等）-->
      <slot :close="() => (open = false)" />
      <button class="am-item" @click="pick('import')"><span class="am-ico">📥</span> 品目のインポート</button>
      <button class="am-item" @click="pick('axis')"><span class="am-ico">🔀</span> 並び替え</button>
      <button class="am-item" @click="doExport"><span class="am-ico">📤</span> CSVエクスポート</button>
      <button class="am-item" @click="doTemplate"><span class="am-ico">📄</span> Excelテンプレート</button>
      <button class="am-item" @click="pick('device')"><span class="am-ico">📱</span> 端末名</button>
      <button class="am-item" @click="pick('push')"><span class="am-ico">🔔</span> プッシュ通知</button>
    </div>
  </div>
</template>

<style scoped>
.am-wrap { position: relative; display: inline-block; }
.am-btn {
  background: none; border: none; font-size: 20px; line-height: 1; cursor: pointer;
  padding: 6px 8px; border-radius: 8px; color: #374151;
}
.am-btn.open { background: #eef2ff; color: #2563eb; }
.am-backdrop { position: fixed; inset: 0; z-index: 40; }
.am-dropdown {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 41;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15); padding: 6px; min-width: 220px;
}
.am-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 11px 12px; border: none; background: none; border-radius: 8px;
  font-size: 14px; color: #374151; cursor: pointer; text-align: left;
}
.am-item:active { background: #f1f5f9; }
.am-ico { width: 20px; text-align: center; }

/* slot で差し込まれる画面固有の項目にも同じ見た目を当てる */
:slotted(.am-item) {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 11px 12px; border: none; background: none; border-radius: 8px;
  font-size: 14px; color: #374151; cursor: pointer; text-align: left;
}
:slotted(.am-item:active) { background: #f1f5f9; }
:slotted(.am-ico) { width: 20px; text-align: center; }
</style>
