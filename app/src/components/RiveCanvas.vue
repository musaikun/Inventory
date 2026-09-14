<template>
  <div class="rive-surface" :aria-busy="status === 'loading'">
    <canvas ref="canvas" :aria-label="label" role="img" />
    <p v-if="status === 'loading'" class="rive-message" role="status">読み込み中…</p>
    <p v-else-if="status === 'error'" class="rive-message" role="alert">
      読み込めませんでした。.rivファイルと再生対象を確認してください。
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  src: { type: String, default: '' },
  buffer: { type: ArrayBuffer, default: null },
  artboard: { type: String, default: '' },
  stateMachine: { type: String, default: '' },
  autoplay: { type: Boolean, default: true },
  label: { type: String, default: 'Riveアニメーション' },
})
const emit = defineEmits(['ready', 'error'])
const canvas = ref(null)
const status = ref('idle')
let instance = null
let revision = 0
let mounted = false
let observer = null
let motionQuery = null

function dispose() {
  revision += 1
  instance?.cleanup()
  instance = null
}

function syncPlayback() {
  if (!instance || status.value !== 'ready') return
  if (props.autoplay && !document.hidden && !motionQuery?.matches) {
    instance.play()
    instance.startRendering()
  } else {
    instance.pause()
    if (!document.hidden) instance.drawFrame()
    instance.stopRendering()
  }
}

function resize() {
  if (!instance || status.value !== 'ready') return
  instance.resizeDrawingSurfaceToCanvas(Math.min(window.devicePixelRatio || 1, 2))
  syncPlayback()
}

async function load() {
  dispose()
  status.value = 'idle'
  if (!mounted || (!props.src && !props.buffer)) return
  const request = revision
  const isCurrent = () => mounted && request === revision
  status.value = 'loading'
  const fail = (error) => {
    if (!isCurrent()) return
    dispose()
    status.value = 'error'
    emit('error', error)
  }
  try {
    // 素材が指定されたときだけランタイムを取得する。
    const { Rive, Layout, Fit, Alignment } = await import('../utils/riveRuntime.js')
    if (!isCurrent()) return
    instance = new Rive({
      canvas: canvas.value,
      ...(props.buffer ? { buffer: props.buffer } : { src: props.src }),
      artboard: props.artboard || undefined,
      stateMachine: props.stateMachine || undefined,
      autoplay: false,
      autoBind: true,
      useOffscreenRenderer: true,
      enableRiveAssetCDN: false,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        if (!isCurrent()) return
        status.value = 'ready'
        resize()
        emit('ready', {
          artboards: instance.contents.artboards.map(artboard => artboard.name),
          stateMachines: instance.stateMachineNames,
          animations: instance.animationNames,
        })
      },
      onLoadError: fail,
    })
  } catch (error) {
    fail(error)
  }
}

onMounted(() => {
  mounted = true
  motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  motionQuery?.addEventListener('change', syncPlayback)
  document.addEventListener('visibilitychange', syncPlayback)
  window.addEventListener('resize', resize)
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize)
    observer.observe(canvas.value)
  }
  load()
})
watch(() => [props.src, props.buffer, props.artboard, props.stateMachine], load)
watch(() => props.autoplay, syncPlayback)
onBeforeUnmount(() => {
  mounted = false
  dispose()
  observer?.disconnect()
  motionQuery?.removeEventListener('change', syncPlayback)
  document.removeEventListener('visibilitychange', syncPlayback)
  window.removeEventListener('resize', resize)
})
</script>

<style scoped>
.rive-surface { position: relative; width: 100%; height: 100%; }
canvas { display: block; width: 100%; height: 100%; }
.rive-message { position: absolute; inset: 0; display: grid; place-content: center; margin: 0; padding: 16px; text-align: center; background: #f8fafce8; color: #334155; }
</style>
