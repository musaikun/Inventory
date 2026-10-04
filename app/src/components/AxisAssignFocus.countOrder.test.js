// 前回の棚卸の数えた順で並べる（User決定 2026-10-04）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg = null
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await tick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim().includes(label))

async function mount() {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Focus, { initialAxis: 0 }) })
  app.mount(host)
  await tick()
}
const a = (ingredient, t, who = 'p1') => ({ ingredient, action: 'new', timestamp: t, enteredById: who, enteredBy: who === 'p1' ? '高木' : '山田' })
async function seedHistory(auditLog) {
  const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
    s1: { sessionId: 's1', date: '2026-10-01', savedAt: '2026-10-01T01:00:00Z', items: [], auditLog },
  }))
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  for (const n of ['塩', '卵', '牛乳', 'アイス', 'パスタ']) cfg.addItem(n, 0, '', '個')
  cfg.setAxisName(0, '保管場所')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('数えた順で並べる', () => {
  it('履歴が無ければ入口を出さない', async () => {
    await mount()
    expect(btn('前回の数えた順')).toBeUndefined()
  })

  it('未振り分け: 担当者ごとに分けて並べ、タップで区切って場所を作る。元に戻せる', async () => {
    await seedHistory([a('牛乳', 1), a('パスタ', 2, 'p2'), a('卵', 3), a('アイス', 4), a('塩', 5, 'p2'), a('卵', 6, 'p2')])
    await mount()
    await click(btn('前回の数えた順で場所を作る'))
    const names = () => [...host.querySelectorAll('.co-grp')].map(g => [...g.querySelectorAll('.co-item')].map(e => e.textContent))
    expect(names()).toEqual([['牛乳', '卵', 'アイス'], ['パスタ', '塩', '卵']])
    expect(host.querySelectorAll('.co-multi').length).toBe(2)
    // 高木さんの「アイス」から別の場所に
    await click(host.querySelector('.co-row[data-row="2"]'))
    await click(btn('「アイス」から別の場所にする'))
    expect(names()).toEqual([['牛乳', '卵'], ['アイス'], ['パスタ', '塩', '卵']])
    const inputs = host.querySelectorAll('.co-name')
    await type(inputs[0], '冷蔵庫'); await type(inputs[1], '冷凍庫'); await type(inputs[2], '棚')
    await click(btn('3つの場所で決める'))
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', '冷凍庫', '棚'])
    expect(cfg.config.tagsA['卵']).toEqual(['冷蔵庫', '棚'])
    expect(cfg.config.tagsA['アイス']).toEqual(['冷凍庫'])
    expect(cfg.axisItemSequence(0)).toEqual(['牛乳', '卵', 'アイス', 'パスタ', '塩'])
    // 品目全体の並び（ジャンルの中の順の元）は触らない
    expect(cfg.config.order).toEqual(['塩', '卵', '牛乳', 'アイス', 'パスタ'])
    await click(btn('元に戻す'))
    expect(cfg.config.tagsA['卵']).toBeUndefined()
    expect(cfg.axisItemSequence(0)).toEqual(['塩', '卵', '牛乳', 'アイス', 'パスタ'])
  })

  it('振り分け済み: 割り当てはそのまま、並びだけを数えた順にする', async () => {
    await seedHistory([a('牛乳', 1), a('卵', 2), a('塩', 3)])
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.setItemTag('卵', 0, '冷蔵庫')
    await mount()
    await click(btn('前回の数えた順に並べ直す'))
    expect(host.textContent).toContain('各場所の中だけが数えた順')
    await click(btn('この順に並べ直す'))
    expect(cfg.axisItemSequence(0)).toEqual(['牛乳', '卵', '塩', 'アイス', 'パスタ'])
    expect(cfg.config.order).toEqual(['塩', '卵', '牛乳', 'アイス', 'パスタ'])
    expect(cfg.config.tagsA['卵']).toEqual(['冷蔵庫'])
    expect(cfg.config.tagsA['牛乳']).toBeUndefined()
  })
})
