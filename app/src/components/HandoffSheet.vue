<script setup>
/**
 * 申し送りを書く（📣 伝える／🙏 頼む）・伝えられたことを「やることにする」（User決定 2026-10-25・モック docs/mocks/journal-calendar-v4.html）。
 * 説明文は置かない: 種類は絵と一言、決めるボタンに「佐藤さんに頼む」のように何が起きるかを書く
 * convert: 伝えられた申し送り（📣）を渡すと「やることにする」になる
 */
import { ref, computed, onUnmounted } from 'vue'
import { tellHandoff, askHandoff, handoffToTask, HANDOFF_BODY_MAX } from '../composables/useHandoffs.js'
import { staffNames } from '../composables/useAuth.js'
import { isMeId, actorId, deviceName } from '../composables/useDeviceId.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  convert: { type: Object, default: null },
})
const emit = defineEmits(['close'])
const today = localDateKey()
const _plus = n => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateKey(d) }

const kind = ref(props.convert ? 'ask' : 'tell')
const body = ref(props.convert?.body ?? '')
const to = ref(props.convert && !isMeId(props.convert.byId) ? 'me' : 'anyone')   // anyone | me | <id>
const when = ref(props.convert ? today : _plus(1))
const progress = ref(false)
const busy = ref(false)
const err = ref('')
const people = computed(() => staffNames.value.filter(p => !isMeId(p.id)))
const target = computed(() => {
  if (to.value === 'anyone') return null
  if (to.value === 'me') { const me = staffNames.value.find(p => isMeId(p.id)); return me ? { id: me.id, name: me.name } : { id: actorId(), name: deviceName.value || '' } }
  const p = people.value.find(x => x.id === to.value)
  return p ? { id: p.id, name: p.name } : null
})
const goLabel = computed(() => {
  if (props.convert) return 'やることにする'
  if (kind.value === 'tell') return '📣 伝える'
  return target.value && to.value !== 'me' ? `${target.value.name}さんに頼む` : '🙏 頼む'
})
const dateIn = ref(null)
async function go() {
  if (!body.value.trim() || busy.value) return
  busy.value = true; err.value = ''
  try {
    if (props.convert) await handoffToTask(props.convert, { body: body.value, to: target.value, date: when.value, progress: progress.value })
    else if (kind.value === 'tell') await tellHandoff(body.value)
    else await askHandoff({ body: body.value, to: target.value, date: when.value, progress: progress.value })
    emit('close')
  } catch (e) { err.value = e?.message || '送れませんでした' } finally { busy.value = false }
}
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="hs-bg" @click.self="emit('close')">
      <form class="hs" role="dialog" :aria-label="convert ? 'やることにする' : '申し送り'" @submit.prevent="go">
        <div class="hs-h"><button type="button" class="hs-c" @click="emit('close')">やめる</button><b>{{ convert ? '📣 → ✓' : '申し送り' }}</b><span></span></div>
        <div v-if="!convert" class="hs-k" role="group" aria-label="種類">
          <button type="button" :class="{ on: kind === 'tell' }" :aria-pressed="kind === 'tell'" @click="kind = 'tell'"><em>📣</em>伝える</button>
          <button type="button" :class="['ask', { on: kind === 'ask' }]" :aria-pressed="kind === 'ask'" @click="kind = 'ask'"><em>🙏</em>頼む</button>
        </div>
        <textarea v-model="body" rows="3" :maxlength="HANDOFF_BODY_MAX" class="hs-in" aria-label="中身"></textarea>
        <template v-if="kind === 'ask' || convert">
          <div class="hs-p" role="group" aria-label="だれに">
            <button type="button" :class="{ on: to === 'anyone' }" @click="to = 'anyone'">👥 誰でも</button>
            <button type="button" :class="{ on: to === 'me' }" @click="to = 'me'">自分</button>
            <button v-for="p in people" :key="p.id" type="button" :class="{ on: to === p.id }" @click="to = p.id">{{ p.name }}</button>
          </div>
          <div class="hs-p" role="group" aria-label="いつ">
            <button type="button" :class="{ on: when === today }" @click="when = today">今日</button>
            <button type="button" :class="{ on: when === _plus(1) }" @click="when = _plus(1)">明日</button>
            <label :class="['hs-date', { on: when !== today && when !== _plus(1) }]">📅<input ref="dateIn" v-model="when" type="date" aria-label="日付" /></label>
            <button type="button" :class="{ on: progress }" :aria-pressed="progress" @click="progress = !progress">⏳ 何日か</button>
          </div>
        </template>
        <p v-if="err" class="hs-err" role="alert">{{ err }}</p>
        <button type="submit" class="hs-go" :disabled="!body.trim() || busy">{{ goLabel }}</button>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.hs-bg { position: fixed; inset: 0; z-index: 122; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.hs { width: 100%; max-width: 600px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.hs-h { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.hs-h b { font-size: 16px; }
.hs-c { justify-self: start; border: none; background: none; font: inherit; font-weight: 800; color: var(--text-muted); cursor: pointer; padding: 6px 0; }
.hs-k { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.hs-k button { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; border: 1.5px solid var(--border); background: var(--surface); border-radius: 14px; font: inherit; font-size: 15px; font-weight: 900; color: var(--text); cursor: pointer; }
.hs-k button em { font-style: normal; font-size: 20px; }
.hs-k button.on { border-color: #0e7490; background: #ecfeff; color: #0e7490; }
.hs-k button.ask.on { border-color: #ec4899; background: #fdf2f8; color: #9d174d; }
.hs-in { width: 100%; box-sizing: border-box; border: 1.5px solid #67e8f9; border-radius: 12px; padding: 10px; font: inherit; font-size: 15px; resize: none; background: var(--surface); color: var(--text); }
.hs-p { display: flex; flex-wrap: wrap; gap: 6px; }
.hs-p button, .hs-date { border: none; background: #f1f5f9; border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 800; color: #475569; cursor: pointer; min-height: 34px; }
.hs-p .on { background: #0f2a33; color: #fff; }
.hs-date { position: relative; display: inline-flex; align-items: center; overflow: hidden; }
.hs-date input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.hs-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.hs-go { min-height: 48px; border: none; border-radius: 12px; background: linear-gradient(90deg, #22d3ee, #34d399); color: #06323c; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; }
.hs-go:disabled { opacity: .5; }
</style>
