<template>
  <main>
    <h1>Rive 試験ページ</h1>
    <section class="editor-draft" aria-labelledby="editor-draft-title">
      <h2 id="editor-draft-title">Rive Editorで作成したホイール</h2>
      <p>開閉700msの試作です。下の画像はRive Editorの描画結果です。アニメーションの再生ではありません。</p>
      <p><a href="https://editor.rive.app/file/untitled/2564146" target="_blank" rel="noopener noreferrer">Rive Editorで試作を開く</a>
        · <a href="/assets/wheel-rive-guide.md" download>確認手順</a></p>
      <div class="editor-poses">
        <figure><img src="/assets/wheel-rive-closed.png" width="750" height="672" alt="閉じた状態。中央のカードだけを表示" /><figcaption>閉じた状態</figcaption></figure>
        <figure><img src="/assets/wheel-rive-open.png" width="750" height="672" alt="開いた状態。前後のカードと右側の操作部を表示" /><figcaption>開いた状態</figcaption></figure>
      </div>
      <p>現在のRiveプランでは.rivを書き出せないため、この試作のアプリ内再生は未確認です。名称・数量は仮データです。</p>
    </section>
    <WheelDraft />
    <h2>.rivファイルの動作確認</h2>
    <p>書き出した.rivファイルを選んで、動きと操作感を確認できます。</p>
    <label class="file">.rivファイル
      <input type="file" accept=".riv" @change="selectFile" />
    </label>
    <p role="status">{{ message }}</p>
    <div class="controls">
      <label>アートボード
        <select v-model="artboard" :disabled="!buffer">
          <option value="">ファイルの既定</option>
          <option v-for="name in artboards" :key="name">{{ name }}</option>
        </select>
      </label>
      <label>ステートマシン
        <select v-model="stateMachine" :disabled="!buffer">
          <option value="">未指定</option>
          <option v-for="name in stateMachines" :key="name">{{ name }}</option>
        </select>
      </label>
      <label>表示幅
        <select v-model.number="width">
          <option :value="375">375px</option>
          <option :value="768">768px</option>
          <option :value="1024">1024px</option>
        </select>
      </label>
      <button :disabled="!buffer" @click="playing = !playing">{{ playing ? '一時停止' : '再生' }}</button>
      <button :disabled="!buffer" @click="reloadKey += 1">最初から読み直す</button>
    </div>
    <div class="preview" :style="{ width: `${width}px` }">
      <RiveCanvas v-if="buffer" :key="reloadKey" :buffer="buffer" :artboard="artboard"
        :state-machine="stateMachine" :autoplay="playing" @ready="ready" @error="loadError" />
      <p v-else class="empty">ここにアニメーションが表示されます</p>
    </div>
    <p>端末の「動きを減らす」が有効な場合は静止表示になります。</p>
    <p>画像・フォント・音声はファイルへ埋め込んで書き出してください。選んだファイルはサーバーへ保存されません。</p>
  </main>
</template>

<script setup>
import { ref, shallowRef, watch } from 'vue'
import RiveCanvas from '../../src/components/RiveCanvas.vue'
import WheelDraft from './WheelDraft.vue'

const buffer = shallowRef(null)
const artboards = ref([])
const stateMachines = ref([])
const artboard = ref('')
const stateMachine = ref('')
const width = ref(375)
const playing = ref(true)
const reloadKey = ref(0)
const message = ref('ファイルを選択してください。')
let fileRevision = 0
let filename = ''

watch(artboard, () => {
  stateMachine.value = ''
  stateMachines.value = []
})

async function selectFile(event) {
  const request = ++fileRevision
  const file = event.target.files?.[0]
  if (!file) return
  buffer.value = null
  artboards.value = []
  stateMachines.value = []
  artboard.value = ''
  stateMachine.value = ''
  if (!file.name.toLowerCase().endsWith('.riv')) {
    message.value = '.rivファイルを選択してください。'
    return
  }
  message.value = 'ファイルを読み込み中…'
  try {
    const data = await file.arrayBuffer()
    if (request !== fileRevision) return
    filename = file.name
    buffer.value = data
    playing.value = true
  } catch (error) {
    if (request === fileRevision) loadError(error)
  } finally {
    // 同じファイルを書き出し直した場合にも選び直せる。
    if (request === fileRevision) event.target.value = ''
  }
}

function ready(info) {
  artboards.value = info.artboards
  stateMachines.value = info.stateMachines
  message.value = `${filename} — 読み込み完了`
}

function loadError(error) {
  message.value = '読み込めませんでした。ファイルとアートボード・ステートマシンを確認してください。'
  console.error('[Rive試験ページ]', error)
}
</script>

<style>
* { box-sizing: border-box; }
body { margin: 0; color: #1e293b; background: #f1f5f9; font: 15px/1.6 system-ui, sans-serif; }
main { max-width: 1120px; margin: auto; padding: 24px 16px; }
h1 { font-size: 24px; }
.editor-draft { padding: 16px; border: 1px solid #cbd5e1; border-radius: 12px; background: white; }
.editor-poses { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 16px; }
.editor-poses figure { margin: 0; }
.editor-poses img { display: block; width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
.editor-poses figcaption { margin-top: 8px; text-align: center; }
label { display: grid; gap: 6px; }
.file { margin: 24px 0 12px; }
.controls { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin: 20px 0; }
select, button, input { min-height: 44px; max-width: 100%; font: inherit; }
select, button { padding: 8px 12px; border: 1px solid #94a3b8; border-radius: 6px; background: white; color: #1e293b; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .5; }
.preview { max-width: 100%; height: 320px; border: 1px solid #cbd5e1; border-radius: 8px; background: white; overflow: hidden; }
.empty { height: 100%; margin: 0; display: grid; place-content: center; padding: 16px; color: #475569; text-align: center; }
</style>
