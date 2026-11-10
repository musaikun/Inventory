<script setup>
/**
 * オーナーの暗証番号を変える（D-036・User決定 2026-11-10）。
 * - mode='upgrade': 4桁の店がログインしたあとに出す。「6桁に変えてください」と期限。期限までは「あとで」で閉じられ、
 *   期限を過ぎたら閉じられない（変えるまで先へ進めない）
 * - mode='change': 設定の「暗証番号を変える」から。いつでも閉じられる
 * 今の番号 → 新しい番号（6桁・弱い並びは不可）を2回。サーバーは今の番号の間違いをログインと同じ回数に数える
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import PasswordReveal from './PasswordReveal.vue'
import { changeOwnerPin, pinProblem, pinUpgrade, pinUpgradeOverdue } from '../composables/useAuth.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ mode: { type: String, default: 'change' } })
const emit = defineEmits(['close', 'done'])

const cur = ref(''), next = ref(''), again = ref('')
const err = ref(''), busy = ref(false), doneMsg = ref('')
const curEl = ref(null)
const isUpgrade = computed(() => props.mode === 'upgrade')
const locked = computed(() => isUpgrade.value && pinUpgradeOverdue.value)   // 期限を過ぎたら閉じられない
const dueLabel = computed(() => {
  const d = pinUpgrade.value?.due
  if (!d) return ''
  const t = new Date(d)
  return `${t.getMonth() + 1}月${t.getDate()}日`
})
const digits = v => String(v).replace(/\D/g, '').slice(0, 6)
const canSubmit = computed(() => /^(\d{4}|\d{6})$/.test(cur.value) && next.value.length === 6 && again.value.length === 6 && !busy.value)

async function submit() {
  err.value = ''
  const bad = pinProblem(next.value)
  if (bad) { err.value = bad; return }
  if (next.value !== again.value) { err.value = '新しい暗証番号の確認が一致しません'; return }
  if (next.value === cur.value) { err.value = '今と同じ暗証番号です'; return }
  busy.value = true
  try {
    await changeOwnerPin(cur.value, next.value)
    doneMsg.value = '暗証番号を変えました。次からは新しい6桁で入ってください'
    emit('done')
  } catch (e) {
    err.value = e?.message || '変えられませんでした'
    if (e?.code === 'wrong_pin') { cur.value = ''; nextTick(() => curEl.value?.focus()) }
  } finally { busy.value = false }
}
function close() { if (!locked.value) emit('close') }
onMounted(() => nextTick(() => curEl.value?.focus()))
onUnmounted(registerInnerLayerCloser(() => { close(); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="pc-bg" @click.self="close">
      <form class="pc" role="dialog" :aria-label="isUpgrade ? '暗証番号を6桁に' : '暗証番号を変える'" @submit.prevent="submit">
        <template v-if="doneMsg">
          <b class="pc-t">変えました</b>
          <p class="pc-lead">{{ doneMsg }}</p>
          <button type="button" class="pc-go" @click="emit('close')">閉じる</button>
        </template>
        <template v-else>
          <b class="pc-t">{{ isUpgrade ? '暗証番号を6桁に変えてください' : '暗証番号を変える' }}</b>
          <p v-if="isUpgrade" :class="['pc-lead', { late: locked }]">
            暗証番号は6桁になりました（スタッフと同じ）。
            <template v-if="locked">期限を過ぎたので、変えるまで先へ進めません。</template>
            <template v-else-if="dueLabel"><b>{{ dueLabel }}</b>までは今の4桁でも入れます。</template>
          </p>
          <label class="pc-lb">今の暗証番号
            <PasswordReveal v-slot="{ type }">
              <input ref="curEl" :type="type" inputmode="numeric" class="pc-in" placeholder="●●●●" maxlength="6" autocomplete="current-password"
                aria-label="今の暗証番号" :value="cur" @input="e => { cur = digits(e.target.value); e.target.value = cur }" />
            </PasswordReveal>
          </label>
          <label class="pc-lb">新しい暗証番号（6桁）
            <PasswordReveal v-slot="{ type }">
              <input :type="type" inputmode="numeric" class="pc-in" placeholder="●●●●●●" maxlength="6" autocomplete="new-password"
                aria-label="新しい暗証番号" :value="next" @input="e => { next = digits(e.target.value); e.target.value = next }" />
            </PasswordReveal>
          </label>
          <label class="pc-lb">新しい暗証番号（確認）
            <PasswordReveal v-slot="{ type }">
              <input :type="type" inputmode="numeric" class="pc-in" placeholder="●●●●●●" maxlength="6" autocomplete="new-password"
                aria-label="新しい暗証番号（確認）" :value="again" @input="e => { again = digits(e.target.value); e.target.value = again }" />
            </PasswordReveal>
          </label>
          <p class="pc-hint">123456 や 000000、同じ並びのくり返しは使えません</p>
          <p v-if="err" class="pc-err" role="alert">{{ err }}</p>
          <div class="pc-acts">
            <button v-if="!locked" type="button" class="pc-later" @click="close">{{ isUpgrade ? 'あとで' : 'やめる' }}</button>
            <button type="submit" class="pc-go" :disabled="!canSubmit">{{ busy ? '変えています…' : '変える' }}</button>
          </div>
        </template>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.pc-bg { position: fixed; inset: 0; z-index: 140; background: rgba(6,34,43,.45); display: flex; align-items: flex-end; justify-content: center; }
.pc { width: 100%; max-width: 520px; background: var(--surface, #fff); border-radius: 20px 20px 0 0; padding: 18px 16px calc(20px + env(safe-area-inset-bottom)); display: grid; gap: 12px; box-sizing: border-box; }
.pc-t { font-size: 17px; }
.pc-lead { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text); background: #ecfeff; border-radius: 10px; padding: 10px 12px; }
.pc-lead.late { background: #fef2f2; color: #991b1b; }
.pc-lb { display: grid; gap: 4px; font-size: 12px; font-weight: 800; color: var(--text-muted); }
.pc-in { width: 100%; min-height: 46px; box-sizing: border-box; border: 1.5px solid #b9d3da; border-radius: 10px; padding: 0 12px; font: inherit; font-size: 18px; letter-spacing: .2em; background: #f7fbfc; color: var(--text); }
.pc-in:focus { outline: none; border-color: var(--primary, #0e7490); background: var(--surface, #fff); box-shadow: 0 0 0 3px rgba(14,116,144,.15); }
.pc-hint { margin: -4px 0 0; font-size: 11.5px; color: var(--text-muted); }
.pc-err { margin: 0; font-size: 13px; font-weight: 700; color: #b91c1c; }
.pc-acts { display: flex; gap: 8px; }
.pc-later { flex: 1; min-height: 48px; border: 1.5px solid #cfdde2; border-radius: 12px; background: var(--surface, #fff); font: inherit; font-weight: 800; color: var(--text); cursor: pointer; }
.pc-go { flex: 2; min-height: 48px; border: none; border-radius: 12px; background: var(--grad-btn, #0e7490); color: var(--on-grad, #08323c); font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; }
.pc-go:disabled { opacity: .5; cursor: default; }
</style>
