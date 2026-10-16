<script setup>
/**
 * 設定タブの中身（User決定 2026-10-16・モック docs/mocks/settings-tab.html）。
 * 以前「各種設定」の中に隠れていたものを、まとまりごとに直接並べる。押すとその項目だけのシートが開く。
 * - part="top":    お店（店名・オーナーの名前・スタッフ）→ 発注
 * - part="bottom": この端末 → アカウント → サポート
 * （間に MasterManagePage の「全品目を削除」が入る）
 * 見えるものは権限で変える。端末名はログインしていない端末（以前の使い方）だけ
 */
import { ref, computed } from 'vue'
import {
  isAuthenticated, storeName, isAdmin, currentStaff, ownerName, can,
  updateStoreName, updateOwnerName,
} from '../composables/useAuth.js'
import { settingsSection } from '../composables/appMenuState.js'
import { staffPageOpen } from '../composables/staffNav.js'
import { pushSubscribed } from '../composables/usePush.js'
import { useWeather } from '../composables/useWeather.js'
import { hiddenHintCount } from '../composables/useHints.js'
import pkg from '../../package.json'

const props = defineProps({
  part: { type: String, default: 'top' },
  isGuest: { type: Boolean, default: false },
})
const emit = defineEmits(['schedule', 'orderBase', 'feedback'])

const isOwner = computed(() => isAuthenticated.value && !currentStaff.value)
const { state: weatherState } = useWeather()
const version = pkg.version
const open = s => { settingsSection.value = s }
const openStaff = () => { staffPageOpen.value = true }

// 店名・オーナーの名前はその場で直す
const editing = ref('')     // '' | 'store' | 'owner'
const input = ref('')
const error = ref('')
const saving = ref(false)
function startEdit(k) {
  editing.value = k; error.value = ''
  input.value = k === 'store' ? (storeName.value || '') : (ownerName.value || '')
}
async function save() {
  const n = input.value.trim()
  if (!n) { error.value = editing.value === 'store' ? '店名を入れてください' : '名前を入れてください'; return }
  saving.value = true; error.value = ''
  try {
    if (editing.value === 'store') await updateStoreName(n)
    else await updateOwnerName(n)
    editing.value = ''
  } catch (e) { error.value = e?.message || '変えられませんでした' }
  finally { saving.value = false }
}
</script>

<template>
  <div class="sl">
    <template v-if="props.part === 'top'">
      <template v-if="isAuthenticated && !props.isGuest">
        <div class="sl-sec">お店</div>
        <div class="sl-box">
          <template v-if="editing === 'store'">
            <div class="sl-edit">
              <input v-model="input" class="sl-input" maxlength="50" aria-label="店名" @keyup.enter="save" />
              <p v-if="error" class="sl-err">{{ error }}</p>
              <div class="sl-edit-row">
                <button type="button" class="sl-btn sec" @click="editing = ''">やめる</button>
                <button type="button" class="sl-btn" :disabled="saving" @click="save">店名を変える</button>
              </div>
            </div>
          </template>
          <button v-else type="button" class="sl-it" :disabled="!isAdmin" @click="startEdit('store')">
            <span class="sl-ic">🏪</span><span class="sl-tx"><b>店名</b><small>{{ storeName || '未設定' }}</small></span>
            <span v-if="isAdmin" class="sl-ar" aria-hidden="true">›</span>
          </button>
          <template v-if="isOwner">
            <div v-if="editing === 'owner'" class="sl-edit">
              <input v-model="input" class="sl-input" maxlength="40" aria-label="オーナーの名前" @keyup.enter="save" />
              <p class="sl-note">どの端末から開いても、この名前で記録されます。変えると過去の記録の名前も変わります。</p>
              <p v-if="error" class="sl-err">{{ error }}</p>
              <div class="sl-edit-row">
                <button type="button" class="sl-btn sec" @click="editing = ''">やめる</button>
                <button type="button" class="sl-btn" :disabled="saving" @click="save">名前を変える</button>
              </div>
            </div>
            <button v-else type="button" class="sl-it" @click="startEdit('owner')">
              <span class="sl-ic">👤</span><span class="sl-tx"><b>オーナーの名前</b><small>どの端末でもこの名前で記録</small></span>
              <span class="sl-val">{{ ownerName || '未設定' }}</span><span class="sl-ar" aria-hidden="true">›</span>
            </button>
          </template>
          <button v-if="isAdmin" type="button" class="sl-it" @click="openStaff">
            <span class="sl-ic">👥</span><span class="sl-tx"><b>スタッフ</b><small>招待・承認・権限（ホームにもあります）</small></span>
            <span class="sl-ar" aria-hidden="true">›</span>
          </button>
        </div>
      </template>

      <template v-if="can('orderSettings')">
        <div class="sl-sec">発注</div>
        <div class="sl-box">
          <button type="button" class="sl-it" @click="emit('schedule')">
            <span class="sl-ic">🗓</span><span class="sl-tx"><b>発注日・締切</b><small>発注する曜日と締切の時刻</small></span><span class="sl-ar" aria-hidden="true">›</span>
          </button>
          <button type="button" class="sl-it" @click="emit('orderBase')">
            <span class="sl-ic">🎯</span><span class="sl-tx"><b>発注点</b><small>この数以下で「要補充」</small></span><span class="sl-ar" aria-hidden="true">›</span>
          </button>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="sl-sec">この端末</div>
      <div class="sl-box">
        <button v-if="!isAuthenticated" type="button" class="sl-it" @click="open('device')">
          <span class="sl-ic">📱</span><span class="sl-tx"><b>端末名</b><small>記録に出る名前（ログインしていない端末）</small></span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
        <button type="button" class="sl-it" @click="open('push')">
          <span class="sl-ic">🔔</span><span class="sl-tx"><b>通知</b><small>棚卸・やること・発注の締切</small></span>
          <span :class="['sl-val', { on: pushSubscribed }]">{{ pushSubscribed ? 'ON' : 'OFF' }}</span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
        <button type="button" class="sl-it" @click="open('weather')">
          <span class="sl-ic">☀️</span><span class="sl-tx"><b>カレンダーの天気</b><small>位置情報から気温・降水</small></span>
          <span :class="['sl-val', { on: !!weatherState.loc }]">{{ weatherState.loc ? 'ON' : 'OFF' }}</span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
        <button type="button" class="sl-it" @click="open('hints')">
          <span class="sl-ic">💡</span><span class="sl-tx"><b>消した説明を戻す</b><small>{{ hiddenHintCount ? `${hiddenHintCount}件` : '消した説明はありません' }}</small></span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
        <button type="button" class="sl-it" @click="open('cache')">
          <span class="sl-ic">🧹</span><span class="sl-tx"><b>表示の不具合をリセット</b><small>データは消えません</small></span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
      </div>

      <template v-if="isOwner && !props.isGuest">
        <div class="sl-sec">アカウント</div>
        <div class="sl-box">
          <button type="button" class="sl-it" @click="open('analytics')">
            <span class="sl-ic">📊</span><span class="sl-tx"><b>匿名の利用状況の共有</b><small>品目・数量・位置は送りません</small></span>
            <span class="sl-ar" aria-hidden="true">›</span>
          </button>
          <button type="button" class="sl-it danger" @click="open('account')">
            <span class="sl-ic">⚠️</span><span class="sl-tx"><b>アカウントの削除</b><small>すべてのデータを削除・元に戻せません</small></span><span class="sl-ar" aria-hidden="true">›</span>
          </button>
        </div>
      </template>

      <div class="sl-sec">サポート</div>
      <div class="sl-box">
        <button type="button" class="sl-it" @click="emit('feedback')">
          <span class="sl-ic">💬</span><span class="sl-tx"><b>フィードバックを送る</b><small>不具合・要望を開発者へ</small></span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
        <button type="button" class="sl-it" @click="open('legal')">
          <span class="sl-ic">📄</span><span class="sl-tx"><b>規約・プライバシー・サポート</b></span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
        <button type="button" class="sl-it" @click="open('info')">
          <span class="sl-ic">ℹ️</span><span class="sl-tx"><b>アプリ情報</b></span><span class="sl-val">v{{ version }}</span><span class="sl-ar" aria-hidden="true">›</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sl { display: grid; }
.sl-sec { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted, #4c6a72); padding: 14px 4px 6px; }
.sl-box { background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; overflow: hidden; }
.sl-it { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 10px 12px; border: none; border-top: 1px solid #eef4f6; background: none; text-align: left; font: inherit; color: var(--text, #12303a); cursor: pointer; }
.sl-box > :first-child { border-top: none; }
.sl-it:active { background: #edf5f7; }
.sl-it:disabled { cursor: default; }
.sl-it:disabled:active { background: none; }
.sl-ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; font-size: 15px; background: #ecfeff; flex: none; }
.sl-tx { flex: 1; min-width: 0; display: grid; }
.sl-tx b { font-size: 14px; font-weight: 700; }
.sl-tx small { font-size: 11.5px; color: var(--text-muted, #4c6a72); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-val { font-size: 12px; color: var(--text-muted, #4c6a72); font-weight: 700; flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-val.on { color: var(--primary, #0e7490); }
.sl-ar { color: #94a3b8; font-weight: 900; flex: none; }
.sl-it.danger .sl-tx b { color: #b91c1c; }
.sl-it.danger .sl-ic { background: #fef2f2; }
.sl-edit { display: grid; gap: 8px; padding: 12px; border-top: 1px solid #eef4f6; }
.sl-box > .sl-edit:first-child { border-top: none; }
.sl-input { min-height: 44px; border: 1px solid var(--border, #d6e6ea); border-radius: 10px; padding: 0 12px; font-size: 16px; }
.sl-note { margin: 0; font-size: 12px; color: var(--text-muted, #4c6a72); line-height: 1.5; }
.sl-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.sl-edit-row { display: flex; gap: 8px; justify-content: flex-end; }
.sl-btn { min-height: 40px; padding: 0 14px; border: none; border-radius: 10px; background: var(--primary, #0e7490); color: #fff; font-weight: 800; font-size: 13.5px; cursor: pointer; }
.sl-btn.sec { background: var(--surface, #fff); color: var(--text, #12303a); border: 1px solid var(--border, #d6e6ea); }
.sl-btn:disabled { opacity: .5; }
</style>
