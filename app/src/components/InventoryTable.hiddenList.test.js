// 手動非表示の一覧（左スワイプで隠した品目の管理シート）。
// 非表示は引き切ったスワイプなら確認なしに決まるので、誤操作に気づいて開く場所がここ。
// 守りたいのは「最後に隠したものが必ず先頭」と「いつ隠したかが読める」こと。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let cfg = null

async function mountWithHidden() {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Table, { inventory: {}, filledCount: 0, hiddenItems: cfg.config.hiddenItems }),
  })
  app.mount(host)
  await nextTick()
  // 「手動非表示 N件 ・ タップで管理」から管理シートを開く
  host.querySelector('.hidden-notice').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  return host
}

const names = () => [...host.querySelectorAll('.hidden-row-name')].map(el => el.textContent.trim())
const times = () => [...host.querySelectorAll('.hidden-row')].map(r => r.querySelector('.hidden-row-at')?.textContent.trim() ?? null)

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  for (const n of ['トマト', 'レタス', 'なす']) cfg.addItem(n, 100, '野菜', '個')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('InventoryTable — 手動非表示の一覧', () => {
  it('最後に隠した品目が先頭に並ぶ', async () => {
    cfg.hideItem('トマト')
    cfg.config.hiddenAt['トマト'] = '2026-09-05T10:00:00.000Z'
    cfg.hideItem('レタス')
    cfg.config.hiddenAt['レタス'] = '2026-09-07T09:00:00.000Z'
    cfg.hideItem('なす')
    cfg.config.hiddenAt['なす'] = '2026-09-06T12:00:00.000Z'

    await mountWithHidden()
    expect(names()).toEqual(['レタス', 'なす', 'トマト'])
  })

  it('隠した時刻を各行に出す', async () => {
    cfg.hideItem('トマト')      // hideItem が「いま」を記録する
    await mountWithHidden()

    expect(names()).toEqual(['トマト'])
    expect(times()[0]).toMatch(/^今日 \d{1,2}:\d{2}$/)
  })

  it('時刻を持たない品目（記録前に隠したもの）は後ろに回り、時刻は出さない', async () => {
    // 旧データの再現: hiddenItems にはあるが hiddenAt が無い
    cfg.config.hiddenItems.push('なす')
    cfg.hideItem('レタス')

    await mountWithHidden()
    expect(names()).toEqual(['レタス', 'なす'])
    expect(times()[0]).toMatch(/^今日 /)
    expect(times()[1]).toBeNull()
  })

  it('戻すと unhide-item を出す（並び替えても対象を取り違えない）', async () => {
    cfg.hideItem('トマト')
    cfg.config.hiddenAt['トマト'] = '2026-09-05T10:00:00.000Z'
    cfg.hideItem('レタス')
    cfg.config.hiddenAt['レタス'] = '2026-09-07T09:00:00.000Z'

    const onUnhideItem = vi.fn()
    const { default: Table } = await import('./InventoryTable.vue')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({
      render: () => h(Table, { inventory: {}, filledCount: 0, hiddenItems: cfg.config.hiddenItems, onUnhideItem }),
    })
    app.mount(host)
    await nextTick()
    host.querySelector('.hidden-notice').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    // 先頭＝最後に隠した「レタス」
    host.querySelector('.hidden-row-restore').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onUnhideItem).toHaveBeenCalledWith('レタス')
  })
})
