// 起動時の読み込み画面：最低1.6秒は見せ、読み込みが終わってから閉じる。終わらなくても6秒で閉じる
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'
import StartupSplash from './StartupSplash.vue'

let app, host
afterEach(() => { app?.unmount(); host?.remove(); vi.useRealTimers() })

async function mount(ready, progress = ref(0)) {
  host = document.createElement('div'); document.body.appendChild(host)
  const done = vi.fn()
  app = createApp({ render: () => h(StartupSplash, { ready: ready.value, progress: progress.value, onDone: done }) })
  app.mount(host)
  await nextTick()
  return done
}

describe('StartupSplash', () => {
  it('読み込みが早くても最低1.6秒は出し、名前を出してから閉じる', async () => {
    vi.useFakeTimers()
    const done = await mount(ref(true))
    expect(host.querySelector('.ss-name').textContent).toContain('タナオロ')
    vi.advanceTimersByTime(1500)
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(host.querySelector('.ss.named')).not.toBeNull()
    vi.advanceTimersByTime(800)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('読み込みが終わらなければ待ち、6秒で閉じる', async () => {
    vi.useFakeTimers()
    const done = await mount(ref(false))
    vi.advanceTimersByTime(3000)
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000 + 800)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('輪の長さは読み込みの進み具合に合わせる', async () => {
    const progress = ref(0.4)
    await mount(ref(false), progress)
    const ring = host.querySelector('.ss-ring')
    expect(Number(ring.style.strokeDashoffset)).toBeCloseTo(312)   // 520 × (1 − 0.4)
    progress.value = 0.8
    await nextTick()
    expect(Number(ring.style.strokeDashoffset)).toBeCloseTo(104)
  })
})
