<script setup>
/**
 * 品目を1つずつ追加する／1品目の情報を直すシート（「品目・在庫」ページから開く）。
 *
 * 一括取込が前提の作りでは、ファイルを持たない店や新メニューを1つ足したいときに
 * 棚卸を始めるしか道が無かった（User相談 2026-09-29）。一般的な在庫アプリと同じく、
 * 一覧の「＋」から1品目ずつ足せるようにする。
 *
 * - 必須は名前だけ。保存したら名前だけ空にして次の入力を待つ（ジャンル等は続けて使う）
 * - 似た名前があれば、保存前に知らせる（表記ゆれで同じ品目が2つできるのを防ぐ）
 * - 在庫数はここでは入れない。最初の数は棚卸で数える（一覧の数字の根拠を崩さない）
 *
 * 品目を足す画面はこれ1つに統一した（User決定 2026-10-02）。context で場面を分ける:
 *   home    … 品目・在庫の「＋」。続けて何品目でも入れる
 *   session … 棚卸・発注の最中に、検索・音声で見つからなかった名前を登録する。1品目だけ登録し、
 *             親がすぐ数量の画面を開く。棚卸を遅くしないため、名前以外は「詳しく」に畳む
 *   request … ルームのゲスト。登録はせず、ホストへの申請として送る（承認後に数量を入れる）
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useInventory } from '../composables/useInventory.js'
import { can, canSeeMoney } from '../composables/useAuth.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { findSimilarNames } from '../utils/itemMatcher.js'
import { compressItemImage, uploadItemImage, deleteItemImage, itemImageUrl, canUploadItemImage } from '../services/itemImages.js'

const props = defineProps({
  mode:            { type: String, default: 'add' },   // 'add' | 'edit'
  item:            { type: String, default: '' },      // edit のときの品目名
  initialCategory: { type: String, default: '' },
  initialName:     { type: String, default: '' },
  initialUnit:     { type: String, default: '' },
  context:         { type: String, default: 'home' },  // 'home' | 'session' | 'request'
})
// added(name) / saved(name) / request({ name, unit, category }) / unhide(name) / use-existing(name)
const emit = defineEmits(['added', 'saved', 'close', 'request', 'unhide', 'use-existing', 'deleted'])
useEscapeKey(() => close())

const { config, addItem, patchItem, setEmptyList, setItemImage, removeConfigItem, hideItem } = useConfig()
const { inventory } = useInventory()
const isEdit = computed(() => props.mode === 'edit')

const name     = ref(props.initialName || '')
const single   = computed(() => props.context !== 'home')     // 1品目だけ（続けて入れない）
const isRequest = computed(() => props.context === 'request')
const showDetails = ref(props.context === 'home')             // 名前以外の欄（棚卸中は畳む）
const unit     = ref(isEdit.value ? (config.units?.[props.item] ?? '') : props.initialUnit)
const lotSize  = ref(isEdit.value ? (config.lotSizes?.[props.item] ?? '') : '')
const category = ref(isEdit.value ? (config.categories?.[props.item] ?? '') : props.initialCategory)
const price    = ref(isEdit.value ? (config.prices?.[props.item] ?? '') : '')
const error    = ref('')
const added    = ref([])          // このシートで追加した品目（直近が先頭）
const confirmedSimilar = ref('')  // 似た名前の警告を見たうえで押し直した名前
const nameEl = ref(null)

const categoryOptions = computed(() => [...new Set(Object.values(config.categories || {}).filter(Boolean))].sort())
const unitOptions = computed(() => [...new Set(Object.values(config.units || {}).filter(Boolean))].sort())

const trimmed = computed(() => name.value.trim())
const exists  = computed(() => !isEdit.value && !!trimmed.value && (config.order || []).includes(trimmed.value))
// 非表示にしている品目と同じ名前。新しく作らず「表示に戻す」を勧める（同じ品目が2つできるのを防ぐ）
const hiddenMatch = computed(() => exists.value && (config.hiddenItems || []).includes(trimmed.value))
const similar = computed(() => (isEdit.value || !trimmed.value || exists.value) ? [] : findSimilarNames(trimmed.value, config.order || []).slice(0, 3))
const canSave = computed(() => isEdit.value || (!!trimmed.value && !exists.value))

onMounted(() => { if (!isEdit.value) nextTick(() => nameEl.value?.focus()) })

// ── 画像（R2）。選んだ時点で圧縮して保存し、品目へ付けるのは「追加・保存」を押したとき。
// 付けずに閉じたら、保存した画像は消す（どの品目からも指されない画像を残さない）。
// ゲストの申請では出さない（画像の保存は店舗のメンバーだけ）。
const imageEnabled = computed(() => !isRequest.value && canUploadItemImage())
const currentRef = isEdit.value ? (config.images?.[props.item] ?? null) : null
const imgRef     = ref(currentRef)    // 保存したときに付く画像
const pendingRef = ref(null)          // このシートで保存した、まだ品目に付けていない画像
const imgLocal   = ref('')            // 選んだ画像の手元のプレビュー
const imgBusy    = ref(false)
const imgErr     = ref('')
const imgInput   = ref(null)
const imgSrc     = computed(() => imgLocal.value || (imgRef.value ? itemImageUrl(imgRef.value, 't') : ''))

function _dropLocal() { if (imgLocal.value) URL.revokeObjectURL(imgLocal.value); imgLocal.value = '' }
function _discardPending() {
  if (pendingRef.value) deleteItemImage(pendingRef.value)
  pendingRef.value = null
}

async function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  imgErr.value = ''
  imgBusy.value = true
  try {
    const blobs = await compressItemImage(file)
    const ref_ = await uploadItemImage(blobs)
    _discardPending()
    _dropLocal()
    imgLocal.value = URL.createObjectURL(blobs.thumb)
    pendingRef.value = ref_
    imgRef.value = ref_
  } catch (err) {
    imgErr.value = err?.message ? `画像を保存できませんでした（${err.message}）` : '画像を保存できませんでした'
  } finally {
    imgBusy.value = false
  }
}
function removeImage() {
  _discardPending()
  _dropLocal()
  imgRef.value = null
}
// 品目へ付ける。前の画像は保存先から消す
function _commitImage(itemName) {
  if (imgRef.value === (config.images?.[itemName] ?? null)) { pendingRef.value = null; return }
  const prev = setItemImage(itemName, imgRef.value)
  if (prev && prev !== imgRef.value) deleteItemImage(prev)
  pendingRef.value = null
}

function close() {
  _discardPending()
  emit('close')
}
onBeforeUnmount(() => { _discardPending(); _dropLocal() })

// 「追加して次へ」で名前の欄が空に戻るだけだと、登録できたのか体感で分からない（User 2026-10-03）。
// 棚卸の品目登録と同じポップアップで知らせる
const addedPop = ref('')
let _popTimer = null
function _popAdded(n) {
  clearTimeout(_popTimer)
  addedPop.value = ''
  nextTick(() => { addedPop.value = `「${n}」を登録しました` })
  _popTimer = setTimeout(() => { addedPop.value = '' }, 2200)
}
onBeforeUnmount(() => clearTimeout(_popTimer))

// ── 1件削除（User決定 2026-10-07）──────────────────────────────
// どの品目でも消せる。取り込んだことのある品目だけ「次の取込で聞く」ことと、非表示も選べることを添える。
// 棚卸・発注の途中で数が入っている品目は、途中の記録が宙に浮くので消させない。
const delAsk = ref(false)
const isImported = computed(() => isEdit.value && !(config.manualItems ?? []).includes(props.item))
const countedNow = computed(() => isEdit.value && inventory[props.item] != null)
function confirmDelete() {
  if (countedNow.value) return
  const ref0 = config.images?.[props.item]
  if (!removeConfigItem(props.item)) return
  if (ref0) deleteItemImage(ref0).catch(() => {})
  emit('deleted', props.item)
}
function hideInstead() {
  hideItem(props.item)
  emit('saved', props.item)
}

function onNameInput() { error.value = ''; confirmedSimilar.value = '' }

function submit() {
  error.value = ''
  if (isEdit.value) {
    patchItem(props.item, { unit: unit.value, lotSize: lotSize.value, category: category.value, price: price.value })
    if (imageEnabled.value) _commitImage(props.item)
    emit('saved', props.item)
    return
  }
  const n = trimmed.value
  if (!n) return
  if (exists.value) { error.value = 'その名前は既に登録されています'; return }
  // 似た名前は1回だけ止める。同じ名前でもう一度押せば追加する（別の品目のことはある）
  if (similar.value.length && confirmedSimilar.value !== n) { confirmedSimilar.value = n; return }
  // ゲスト：ここでは登録しない。品目リストの正はホスト（承認されたら config で降りてくる）
  if (isRequest.value) { emit('request', { name: n, unit: unit.value.trim(), category: category.value.trim() }); return }
  // サンプルの品目リストのまま足すと、サンプルと自分の品目が混ざる。最初の1品目で空のリストに切り替える
  if (!config.isCustom) setEmptyList()
  const p = Number(price.value)
  const ok = addItem(n, Number.isFinite(p) && p > 0 ? p : null, category.value, unit.value)
  if (!ok) { error.value = '追加できませんでした（無料プランの品目数の上限に達している可能性があります）'; return }
  if (String(lotSize.value).trim()) patchItem(n, { lotSize: lotSize.value })
  if (imgRef.value) _commitImage(n)
  added.value = [n, ...added.value]
  emit('added', n)
  _popAdded(n)
  if (single.value) return   // 棚卸・発注中は1品目だけ。親が数量の画面を開く
  // 続けて入れられるよう、名前・入数・単価だけ空にする（ジャンル・単位は同じものが続きやすい）
  name.value = ''; lotSize.value = ''; price.value = ''; confirmedSimilar.value = ''
  _dropLocal(); imgRef.value = null
  nextTick(() => nameEl.value?.focus())
}
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="addedPop" class="toast" data-type="success" role="status">{{ addedPop }}</div>
    </Transition>
  </Teleport>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-sheet if-sheet" role="dialog" aria-modal="true" :aria-label="isEdit ? '品目の情報' : '品目を追加'">
      <div class="sheet-handle"></div>
      <div class="if-title">{{ isEdit ? '品目の情報' : isRequest ? '品目の追加をホストに申請' : context === 'session' ? '新しい品目を登録' : '品目を追加' }}</div>

      <label class="if-label" for="if-name">品目名{{ isEdit ? '' : '（必須）' }}</label>
      <div v-if="isEdit" class="if-fixed">{{ item }}</div>
      <input
        v-else id="if-name" ref="nameEl" v-model="name" class="if-input req" maxlength="60"
        placeholder="例：ベーコンスライス" enterkeyhint="done"
        @input="onNameInput" @keyup.enter="submit"
      />
      <div v-if="hiddenMatch" class="if-similar armed">
        「<b>{{ trimmed }}</b>」は非表示にしている品目です。新しく作らずに表示へ戻せます。
        <button v-if="!isRequest" type="button" class="if-inline" @click="emit('unhide', trimmed)">表示に戻して使う</button>
      </div>
      <div v-else-if="exists" class="if-err">
        その名前は既に登録されています
        <button v-if="single && !isRequest" type="button" class="if-inline" @click="emit('use-existing', trimmed)">この品目に数量を入れる</button>
      </div>
      <div v-else-if="similar.length" :class="['if-similar', { armed: confirmedSimilar === trimmed }]">
        似た品目があります：<b>{{ similar.join('・') }}</b>
        <span v-if="confirmedSimilar === trimmed">。別の品目なら、もう一度「追加」を押してください</span>
        <span v-else>。同じものなら追加せず、そちらを使ってください</span>
      </div>

      <button v-if="!isEdit && !showDetails" type="button" class="if-more" @click="showDetails = true">
        ＋ 詳しく（{{ imageEnabled ? '写真・' : '' }}単位・入数・ジャンル・単価）
      </button>
      <template v-if="isEdit || showDetails">
      <div v-if="imageEnabled" class="if-photo">
        <button type="button" class="if-avatar" :disabled="imgBusy" aria-label="写真を選ぶ" @click="imgInput?.click()">
          <img v-if="imgSrc" :src="imgSrc" alt="" />
          <span v-else class="if-noimg">no image</span>
          <span v-if="imgBusy" class="if-busy">保存中…</span>
        </button>
        <div class="if-photo-acts">
          <button type="button" class="if-inline" :disabled="imgBusy" @click="imgInput?.click()">{{ imgSrc ? '写真を変える' : '写真を付ける' }}</button>
          <button v-if="imgSrc" type="button" class="if-inline if-inline-sub" :disabled="imgBusy" @click="removeImage">外す</button>
          <div v-if="imgErr" class="if-err">{{ imgErr }}</div>
        </div>
        <input ref="imgInput" type="file" accept="image/*" class="if-file" @change="onPickImage" />
      </div>
      <div class="if-two">
        <div>
          <label class="if-label" for="if-unit">単位</label>
          <input id="if-unit" v-model="unit" class="if-input" maxlength="6" list="if-units" placeholder="個・kg・本" />
          <datalist id="if-units"><option v-for="u in unitOptions" :key="u" :value="u" /></datalist>
        </div>
        <div>
          <label class="if-label" for="if-lot">入数</label>
          <input id="if-lot" v-model="lotSize" class="if-input" maxlength="12" inputmode="numeric" placeholder="1" />
        </div>
      </div>
      <div class="if-two">
        <div>
          <label class="if-label" for="if-cat">ジャンル</label>
          <input id="if-cat" v-model="category" class="if-input" maxlength="20" list="if-cats" placeholder="未設定" />
          <datalist id="if-cats"><option v-for="c in categoryOptions" :key="c" :value="c" /></datalist>
        </div>
        <div v-if="canSeeMoney">
          <label class="if-label" for="if-price">単価（円）</label>
          <input id="if-price" v-model="price" class="if-input" type="number" min="0" inputmode="numeric" placeholder="任意" />
        </div>
      </div>
      </template>

      <p v-if="!isEdit" class="if-note">
        <template v-if="isRequest">ホストが承認すると、数量を入れられます。</template>
        <template v-else-if="context === 'session'">登録すると、続けて数量を入れます。</template>
        <template v-else>在庫数はここでは入れません。最初の数は棚卸で数えます。</template>
      </p>
      <div v-if="error" class="if-err">{{ error }}</div>
      <div v-if="added.length" class="if-added" role="status">✓ 追加しました：{{ added.slice(0, 3).join('・') }}<span v-if="added.length > 3"> ほか{{ added.length - 3 }}件</span></div>

      <!-- 削除（編集のときだけ。確認はこの中で） -->
      <template v-if="isEdit">
        <button v-if="!delAsk && can('item.admin')" type="button" class="if-del-open" @click="delAsk = true">この品目を削除…</button>
        <div v-else class="if-del" role="group" aria-label="品目の削除">
          <p v-if="countedNow" class="if-del-t">棚卸・発注の途中で数が入っています。終えてから削除してください。</p>
          <template v-else>
            <p class="if-del-t">「{{ item }}」を削除しますか？過去の棚卸・発注の記録はそのまま残ります。</p>
            <p v-if="isImported" class="if-del-n">
              取り込んだ品目です。取込元のファイルにも残っていると、次に取り込むときに「前に削除した品目」として入れるかどうかを聞きます。
              棚卸に出したくないだけなら、<b>非表示</b>がおすすめです（いつでも戻せます）。
            </p>
          </template>
          <div class="if-del-acts">
            <button type="button" class="if-btn sec" @click="delAsk = false">やめる</button>
            <button v-if="isImported && !countedNow" type="button" class="if-btn sec" @click="hideInstead">非表示にする</button>
            <button v-if="!countedNow" type="button" class="if-btn danger" @click="confirmDelete">削除する</button>
          </div>
        </div>
      </template>

      <div v-if="!delAsk" class="if-acts">
        <button class="if-btn sec" type="button" @click="close">{{ added.length ? '完了' : single ? 'キャンセル' : '閉じる' }}</button>
        <button class="if-btn pri" type="button" :disabled="!canSave || imgBusy" @click="submit">
          {{ isEdit ? '保存'
            : (confirmedSimilar && confirmedSimilar === trimmed ? '別の品目として追加'
            : isRequest ? 'ホストに申請する'
            : context === 'session' ? '登録して数量へ'
            : '追加して次へ') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.if-del-open { display: block; margin: 14px auto 0; min-height: 40px; border: none; background: none; color: #b91c1c; font-size: 13px; font-weight: 700; cursor: pointer; }
.if-del { margin-top: 14px; padding: 12px; border-radius: 12px; background: #fef2f2; border: 1px solid #fecaca; display: grid; gap: 8px; }
.if-del-t { margin: 0; font-size: 14px; font-weight: 800; color: #7f1d1d; line-height: 1.5; }
.if-del-n { margin: 0; font-size: 12.5px; color: #7f1d1d; line-height: 1.6; }
.if-del-acts { display: flex; gap: 8px; flex-wrap: wrap; }
.if-del-acts .if-btn { flex: 1 1 auto; }
.if-btn.danger { background: #dc2626; color: #fff; border: none; }
.if-sheet { max-height: 92vh; overflow-y: auto; }
.if-title { font-size: 17px; font-weight: 800; color: #12303a; margin-bottom: 6px; }
.if-label { display: block; font-size: 12px; font-weight: 700; color: #3d5a62; margin: 10px 0 4px; }
.if-input {
  width: 100%; box-sizing: border-box; border: 1.5px solid #bfd6dc; border-radius: 10px;
  padding: 10px 12px; font-size: 16px; background: #fff; color: #0b2229;
}
.if-input.req { border-color: var(--primary, #0e7490); }
.if-input:focus { outline: none; border-color: var(--primary, #0e7490); }
.if-fixed { font-size: 16px; font-weight: 800; color: #0b2229; padding: 4px 0; }
.if-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.if-similar {
  margin-top: 8px; font-size: 12.5px; line-height: 1.6; color: #92400e;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 8px 10px;
}
.if-similar.armed { border-color: #f59e0b; }
.if-err { margin-top: 8px; font-size: 12.5px; color: #b91c1c; }
.if-note { font-size: 11.5px; color: #7d969c; margin: 10px 0 0; }
.if-added { margin-top: 10px; font-size: 12.5px; font-weight: 700; color: #047857; background: #f0fdf4; border-radius: 10px; padding: 8px 10px; }
.if-acts { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 14px; }
.if-btn { border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 800; cursor: pointer; }
.if-btn.sec { background: #edf5f7; color: #3d5a62; }
.if-btn.pri { background: var(--primary, #0e7490); color: #fff; }
.if-btn.pri:disabled { opacity: 0.4; cursor: not-allowed; }
.if-more { display: block; margin-top: 10px; border: none; background: none; color: var(--primary, #0e7490); font-weight: 700; font-size: 13px; padding: 4px 0; cursor: pointer; }
.if-photo { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.if-avatar {
  position: relative; width: 64px; height: 64px; flex: none; border-radius: 50%; overflow: hidden;
  border: 1.5px solid #bfd6dc; background: #edf5f7; padding: 0; cursor: pointer;
}
.if-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.if-noimg { font-size: 10px; font-weight: 700; color: #7d969c; }
.if-busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.8); font-size: 10px; font-weight: 800; color: #3d5a62; }
.if-photo-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.if-photo-acts .if-inline { margin-left: 0; }
.if-inline-sub { color: #4c6a72; }
.if-file { display: none; }
.if-inline { display: inline-block; margin-left: 6px; border: 1.5px solid currentColor; background: #fff; border-radius: 8px; padding: 3px 8px; font-weight: 800; font-size: 12px; cursor: pointer; color: var(--primary, #0e7490); }
</style>
