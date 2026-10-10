// 前回の棚卸の数えた順で並べる（User決定 2026-10-04）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg = null
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
// 一括の操作は「ぐるぐる」を描いてから動く（次の描画を待つ）ので、少し待つ
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick(); await new Promise(r => setTimeout(r, 40)); await tick() }
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

  it('振り分け済み: 入口は見出しの ⋯ の中。変わる場所だけ 今→後 を見せ、割り当てはそのまま並びだけ変える', async () => {
    await seedHistory([a('牛乳', 1), a('卵', 2), a('塩', 3)])
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.setItemTag('卵', 0, '冷蔵庫')
    await mount()
    expect(btn('前回の数えた順')).toBeUndefined()          // 主役のボタンには出さない
    await click(host.querySelector('.af-more'))
    await click(btn('前回の数えた順に並べ直す'))
    expect(host.textContent).toContain('変わりません')
    // 冷蔵庫（卵だけ）は変わらない。まだ分けていない品目は「その他」として見せる
    const cmps = [...host.querySelectorAll('.co-cmp')]
    expect(cmps.map(c => c.querySelector('.co-cmp-h b').textContent)).toEqual(['その他'])
    expect([...cmps[0].querySelectorAll('.co-cmp-r .mv')].map(e => e.textContent)).toEqual(['牛乳', '塩'])
    expect(host.querySelector('.co-same').textContent).toContain('冷蔵庫')
    await click(btn('1つの場所を並べ直す'))
    expect(cfg.axisItemSequence(0)).toEqual(['牛乳', '卵', '塩', 'アイス', 'パスタ'])
    expect(cfg.config.order).toEqual(['塩', '卵', '牛乳', 'アイス', 'パスタ'])
    expect(cfg.config.tagsA['卵']).toEqual(['冷蔵庫'])
    expect(cfg.config.tagsA['牛乳']).toBeUndefined()
    // 動いた品目に印。元に戻すは数秒で消えない
    const mark = name => host.querySelector(`.af-item[data-item="${name}"] .af-item-moved`)?.textContent
    expect(mark('牛乳')).toContain('↑')
    expect(mark('塩')).toContain('↓')
    expect(mark('卵')).toBeUndefined()
    await new Promise(r => setTimeout(r, 0))
    expect(host.querySelector('.af-undobar').textContent).toContain('2品目')
    await click(btn('元に戻す'))
    expect(cfg.axisItemSequence(0)).toEqual(['塩', '卵', '牛乳', 'アイス', 'パスタ'])
    expect(mark('牛乳')).toBeUndefined()
  })

  it('もう数えた順になっていれば押せない', async () => {
    await seedHistory([a('塩', 1), a('卵', 2)])
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.setItemTag('卵', 0, '冷蔵庫')
    await mount()
    await click(host.querySelector('.af-more'))
    await click(btn('前回の数えた順に並べ直す'))
    expect(host.querySelectorAll('.co-cmp').length).toBe(0)
    expect(btn('今と同じ順です').disabled).toBe(true)
  })
})

describe('まだ分けていない品目をまとめる', () => {
  it('処理の間は「まとめています…」を出し、連打しても1回だけ', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    await mount()
    await click(btn('「その他」へ'))
    const opt = host.querySelector('.af-rest-opt.pri')
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(host.querySelector('.af-busy').textContent).toContain('まとめています')
    await new Promise(r => setTimeout(r, 40)); await tick()
    expect(host.querySelector('.af-busy')).toBeNull()
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', 'その他'])
    expect(host.querySelector('.af-undobar').textContent).toContain('5品目')
  })

  it('残りを「その他」へまとめて完了にできる。元に戻せる', async () => {
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.setItemTag('卵', 0, '冷蔵庫')
    await mount()
    await click(btn('残り4品目を「その他」へ'))
    await click(host.querySelector('.af-rest-opt.pri'))
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫', 'その他'])
    for (const n of ['塩', '牛乳', 'アイス', 'パスタ']) expect(cfg.config.tagsA[n]).toEqual(['その他'])
    expect(host.querySelector('.af-busy')).toBeNull()
    expect(host.textContent).toContain('全部できました')
    expect(host.querySelector('.af-rest-btn')).toBeNull()
    await click(btn('元に戻す'))
    expect(cfg.config.axisGroupsA).toEqual(['冷蔵庫'])
    expect(cfg.config.tagsA['塩']).toBeUndefined()
  })

  it('直近3回数えていない品目は非表示、残りは「その他」も選べる', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    const snap = (id, d) => ({ sessionId: id, date: d, savedAt: `${d}T01:00:00Z`, items: ['塩', '卵', '牛乳', 'アイス', 'パスタ'].map(item => ({ item, qty: ['塩', '卵'].includes(item) ? 1 : null })) })
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({ s1: snap('s1', '2026-10-01') }))
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.setItemTag('卵', 0, '冷蔵庫')
    const { default: Focus } = await import('./AxisAssignFocus.vue')
    host = document.createElement('div'); document.body.appendChild(host)
    const hidden = []
    app = createApp({ render: () => h(Focus, { initialAxis: 0, onHideItems: list => hidden.push(...list) }) })
    app.mount(host); await tick()
    await click(host.querySelector('.af-rest-btn'))
    const opt = [...host.querySelectorAll('.af-rest-opt')][1]
    expect(opt.textContent).toContain('3品目は非表示')
    await click(opt)
    expect(hidden).toEqual(['牛乳', 'アイス', 'パスタ'])
    expect(cfg.config.tagsA['塩']).toEqual(['その他'])
    expect(cfg.config.tagsA['牛乳']).toBeUndefined()
  })
})
