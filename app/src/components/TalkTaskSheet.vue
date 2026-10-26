<script setup>
/**
 * タスク化（連絡のメッセージ → やること・User決定 2026-10-26・キャンバス「日誌カレンダー」④）。
 * だれが を選んで、4つのボタンのどれかを押せば決まる（決めるボタンは置かない）:
 * 本日中 ／ 日付選択（その日のやること）／ 期限選択（期限までに。期限までは毎日の「終日」に）／ 進行中にする（次に見る日は選ばない。止まったらアプリが知らせる）
 */
import { ref, computed, onUnmounted } from 'vue'
import { handoffToTask, HANDOFF_BODY_MAX } from '../composables/useHandoffs.js'
import { staffNames } from '../composables/useAuth.js'
import { isMeId, actorId, deviceName } from '../composables/useDeviceId.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ message: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])
const today = localDateKey()
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _plus = n => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateKey(d) }
const _md = k => { const d = new Date(k + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const dow = new Date(today + 'T00:00:00').getDay()
const sat = _plus(6 - dow)            // 今週中＝土曜まで
const nextMon = _plus(((8 - dow) % 7) || 7)

const body = ref(props.message.body)
const who = ref('me')   // anyone | me | <id>
const people = computed(() => staffNames.value.filter(p => !isMeId(p.id)))
const target = computed(() => {
  if (who.value === 'anyone') return null
  if (who.value === 'me') { const me = staffNames.value.find(p => isMeId(p.id)); return me ? { id: me.id, name: me.name } : { id: actorId(), name: deviceName.value || '' } }
  const p = people.value.find(x => x.id === who.value)
  return p ? { id: p.id, name: p.name } : null
})
const picker = ref(null)   // 'day' | 'due'
const DAY_PICKS = [[_plus(1), '明日'], [_plus(2), _md(_plus(2))], [_plus(3), _md(_plus(3))], [nextMon, '来週の月曜']]
const DUE_PICKS = [[_plus(1), '明日まで'], [_plus(2), `${_md(_plus(2))}まで`], [sat, '今週中'], [_plus(13 - dow), '来週中']]
const busy = ref(false)
const err = ref('')
async function go(kind, d = null) {
  if (!body.value.trim() || busy.value || !d && (kind === 'day' || kind === 'due')) return
  busy.value = true; err.value = ''
  try {
    const opts = kind === 'today' ? { date: today } : kind === 'day' ? { date: d } : kind === 'due' ? { date: today, deadline: d } : { date: today, progress: true }
    const t = await handoffToTask(props.message, { body: body.value, to: target.value, ...opts })
    emit('done', { task: t, message: props.message })
  } catch (e) { err.value = e?.message || 'タスクにできませんでした' } finally { busy.value = false }
}
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="tts-bg" @click.self="emit('close')">
      <section class="tts" role="dialog" aria-label="タスク化">
        <div class="tts-h"><button type="button" class="tts-c" @click="emit('close')">やめる</button><b>タスク化</b><span></span></div>
        <p class="tts-q"><i>{{ (message.by || '?').slice(0, 1) }}</i>{{ message.by }} 「{{ message.body }}」</p>
        <label class="tts-l">タスク<input v-model="body" type="text" :maxlength="HANDOFF_BODY_MAX" class="tts-in" /></label>
        <div class="tts-l">だれが
          <div class="tts-p">
            <button type="button" :class="{ on: who === 'anyone' }" :aria-pressed="who === 'anyone'" @click="who = 'anyone'">誰でも</button>
            <button type="button" :class="{ on: who === 'me' }" :aria-pressed="who === 'me'" @click="who = 'me'">自分</button>
            <button v-for="p in people" :key="p.id" type="button" :class="{ on: who === p.id }" :aria-pressed="who === p.id" @click="who = p.id">{{ p.name }}</button>
          </div>
        </div>
        <div class="tts-g">
          <button type="button" class="go" :disabled="busy" @click="go('today')">本日中</button>
          <button type="button" :class="{ on: picker === 'day' }" :aria-expanded="picker === 'day'" @click="picker = picker === 'day' ? null : 'day'">日付選択</button>
          <button type="button" :class="{ on: picker === 'due' }" :aria-expanded="picker === 'due'" @click="picker = picker === 'due' ? null : 'due'">期限選択</button>
          <button type="button" class="prog" :disabled="busy" @click="go('prog')">進行中にする</button>
        </div>
        <div v-if="picker" class="tts-pick">
          <span>{{ picker === 'due' ? 'いつまでに' : 'どの日に' }}</span>
          <div class="tts-p">
            <button v-for="x in (picker === 'due' ? DUE_PICKS : DAY_PICKS)" :key="x[0]" type="button" :disabled="busy" @click="go(picker, x[0])">{{ x[1] }}</button>
            <label class="tts-cal">カレンダー<input type="date" :min="today" :aria-label="picker === 'due' ? '期限' : '日付'" @change="e => e.target.value && go(picker, e.target.value)" /></label>
          </div>
        </div>
        <p v-if="err" class="tts-err" role="alert">{{ err }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.tts-bg { position: fixed; inset: 0; z-index: 130; background: rgba(6,34,43,.42); display: flex; align-items: flex-end; justify-content: center; }
.tts { width: 100%; max-width: 600px; background: var(--surface); border-radius: 22px 22px 0 0; padding: 12px 16px calc(20px + env(safe-area-inset-bottom)); display: grid; gap: 12px; }
.tts-h { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.tts-h b { font-size: 16px; }
.tts-c { justify-self: start; border: none; background: none; font: inherit; font-weight: 800; color: var(--text-muted); cursor: pointer; padding: 6px 0; }
.tts-q { margin: 0; display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 12px; background: #f4f7f8; font-size: 12.5px; color: #3d545d; line-height: 1.5; }
.tts-q i { flex: none; width: 22px; height: 22px; border-radius: 50%; background: #7c3aed; color: #fff; font-style: normal; font-size: 10px; font-weight: 900; display: grid; place-items: center; }
.tts-l { display: grid; gap: 4px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.tts-in { height: 44px; box-sizing: border-box; border: 1.5px solid #67c7da; border-radius: 12px; padding: 0 12px; font: inherit; font-size: 15px; font-weight: 700; color: var(--text); background: var(--surface); }
.tts-p { display: flex; flex-wrap: wrap; gap: 6px; }
.tts-p button, .tts-cal { height: 36px; padding: 0 14px; border: none; border-radius: 999px; background: #eef3f5; font: inherit; font-size: 13px; font-weight: 800; color: #3d545d; cursor: pointer; display: inline-flex; align-items: center; }
.tts-p button.on { background: #0f2a33; color: #fff; }
.tts-cal { position: relative; overflow: hidden; }
.tts-cal input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.tts-g { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tts-g button { height: 56px; border: none; border-radius: 16px; background: #eef4f6; font: inherit; font-size: 15px; font-weight: 900; color: var(--text); cursor: pointer; }
.tts-g button.on { background: #0f2a33; color: #fff; }
.tts-g button.go { background: var(--primary, #0e7490); color: #fff; }
.tts-g button.prog { background: #fff4e0; color: #8a4b00; box-shadow: inset 0 0 0 1.5px #f0c27a; }
.tts-pick { display: grid; gap: 6px; padding: 10px; border-radius: 14px; background: #f4f7f8; }
.tts-pick > span { font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.tts-pick .tts-p button { background: var(--surface); box-shadow: inset 0 0 0 1px #c9d6db; }
.tts-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
</style>
