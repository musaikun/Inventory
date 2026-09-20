/**
 * 列指定（見出しの行）から、ひとつ前の「PDFを表にする画面」へ戻れること。
 *
 * 人から見ると 枚数 → 表 → 見出しの行 は一続きの流れなのに、3つめだけ戻り道が無く、
 * 表の組み方を直すには最初からやり直すしかなかった。番号も通しで出す。
 *
 * CSV・Excel から来たときは戻る先が無いので、出さない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, backs = 0

const btn = (t) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(t))

async function mount(canBack) {
  const { default: Mapper } = await import('./ImportMapper.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Mapper, {
      csvText: '品名,単位,単価\n豚バラ,kg,1200\nキャベツ,玉,280',
      filename: 'tanaoroshi.pdf',
      axisNames: ['', ''],
      canBack,
      onImported: () => {}, onClose: () => {}, onBack: () => { backs++ },
    }),
  })
  app.mount(host)
  for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
}

beforeEach(() => { backs = 0; localStorage.clear() })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('ImportMapper — ひとつ前へ戻る', () => {
  it('PDFから来たときは、見出しの行の問いで戻れる', async () => {
    await mount(true)
    expect(host.textContent).toContain('見出しの行を選んでください')
    btn('戻る').click()
    expect(backs).toBe(1)
  })

  it('一続きの流れの3つめであることを出す', async () => {
    await mount(true)
    expect(host.querySelector('.imp-step').textContent.trim()).toBe('3 / 3')
  })

  it('CSV・Excel から来たときは戻る先が無いので出さない', async () => {
    await mount(false)
    expect(host.textContent).toContain('見出しの行を選んでください')
    expect(btn('戻る')).toBeUndefined()
    expect(host.querySelector('.imp-step')).toBe(null)
  })

  it('「見出しの行はありません」は戻ると並べても消えない', async () => {
    await mount(true)
    expect(btn('見出しの行はありません')).not.toBeUndefined()
  })

  it('見出しの行を選んだあとは出さない（そこからは画面の中の「変える」で戻る）', async () => {
    await mount(true)
    host.querySelectorAll('.peek-row')[0].click()
    for (let i = 0; i < 4; i++) await nextTick()
    expect(host.textContent).not.toContain('見出しの行を選んでください')
    expect(btn('戻る')).toBeUndefined()
    expect(host.textContent).toContain('として読んでいます')
  })
})
