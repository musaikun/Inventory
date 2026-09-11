import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, reactive, nextTick, h } from 'vue'
import RiveCanvas from './RiveCanvas.vue'

const runtime = vi.hoisted(() => ({ instances: [] }))
vi.mock('../utils/riveRuntime.js', () => ({
  Rive: class {
    constructor(options) {
      this.options = options
      this.contents = { artboards: [{ name: 'Main' }] }
      this.stateMachineNames = ['Assign']
      this.animationNames = ['Idle']
      for (const method of ['cleanup', 'play', 'pause', 'drawFrame', 'startRendering', 'stopRendering', 'resizeDrawingSurfaceToCanvas']) {
        this[method] = vi.fn()
      }
      runtime.instances.push(this)
    }
  },
  Layout: class {},
  Fit: { Contain: 'contain' },
  Alignment: { Center: 'center' },
}))

let app, host, props, motion, resizeObserver
async function settle() {
  await nextTick()
  await vi.dynamicImportSettled()
  await nextTick()
}
async function mount(extra = {}) {
  props = reactive({ buffer: new ArrayBuffer(8), ...extra })
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(RiveCanvas, props) })
  app.mount(host)
  await settle()
  return runtime.instances.at(-1)
}
beforeEach(() => {
  runtime.instances.length = 0
  motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => motion)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) {
      this.callback = callback
      this.observe = vi.fn()
      this.disconnect = vi.fn()
      resizeObserver = this
    }
  })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => {
  app?.unmount()
  app = null
  host?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RiveCanvasのライフサイクル', () => {
  it('素材が無い間はランタイムを生成しない', async () => {
    await mount({ buffer: null })
    expect(runtime.instances).toHaveLength(0)
    expect(host.textContent).not.toContain('読み込み中')
  })

  it('読み直し後に届く旧ファイルの完了通知を無視する', async () => {
    const ready = vi.fn()
    const old = await mount({ onReady: ready })
    props.buffer = new ArrayBuffer(12)
    await settle()
    const current = runtime.instances.at(-1)
    expect(old.cleanup).toHaveBeenCalledTimes(1)
    old.options.onLoad()
    expect(ready).not.toHaveBeenCalled()
    expect(current.play).not.toHaveBeenCalled()
    current.options.onLoad()
    expect(ready).toHaveBeenCalledWith({ artboards: ['Main'], stateMachines: ['Assign'], animations: ['Idle'] })
    expect(current.play).toHaveBeenCalledTimes(1)
  })

  it('非表示で停止し、明示的に一時停止した場合は復帰しても再生しない', async () => {
    const r = await mount()
    r.options.onLoad()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(r.stopRendering).toHaveBeenCalled()
    props.autoplay = false
    await nextTick()
    r.play.mockClear()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(r.play).not.toHaveBeenCalled()
    props.autoplay = true
    await nextTick()
    expect(r.play).toHaveBeenCalledTimes(1)
  })

  it('動きを減らす設定を初回と変更時の両方で尊重する', async () => {
    motion.matches = true
    const r = await mount()
    r.options.onLoad()
    expect(r.play).not.toHaveBeenCalled()
    expect(r.drawFrame).toHaveBeenCalled()
    expect(r.stopRendering).toHaveBeenCalled()
    motion.matches = false
    motion.addEventListener.mock.calls[0][1]()
    expect(r.play).toHaveBeenCalledTimes(1)
  })

  it('読込エラーを表示し、ファイル選び直しで回復できる', async () => {
    const onError = vi.fn()
    const r = await mount({ onError })
    r.options.onLoadError(new Error('invalid file'))
    await nextTick()
    expect(r.cleanup).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="alert"]').textContent).toContain('読み込めませんでした')
    expect(onError).toHaveBeenCalledTimes(1)
    props.buffer = new ArrayBuffer(16)
    await settle()
    runtime.instances.at(-1).options.onLoad()
    await nextTick()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('サイズ変更に追随し、閉じた後はイベントと遅延通知を処理しない', async () => {
    const ready = vi.fn()
    const r = await mount({ onReady: ready })
    r.options.onLoad()
    r.resizeDrawingSurfaceToCanvas.mockClear()
    resizeObserver.callback()
    expect(r.resizeDrawingSurfaceToCanvas).toHaveBeenCalledTimes(1)
    app.unmount()
    app = null
    expect(r.cleanup).toHaveBeenCalledTimes(1)
    expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1)
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', motion.addEventListener.mock.calls[0][1])
    ready.mockClear()
    r.play.mockClear()
    r.options.onLoad()
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('resize'))
    expect(ready).not.toHaveBeenCalled()
    expect(r.play).not.toHaveBeenCalled()
  })
})
