// データ管理の作り直し（2026-09-15）。
//   - 取り込む / 書き出す の入口を1つずつにし、押してから種類を選ぶ
//   - 並び順は「グループ」で数える。ジャンルも取込元由来のグループとして同じ列に並ぶ
//   - 品目一覧は畳まず常設。数量は打てないが、発注点・目標・表示/非表示をその場で決める
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: '', WS_BASE: '',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null
let host = null
let cfg = null

async function mountPage() {
  const { default: Page } = await import('./MasterManagePage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Page)
  app.mount(host)
  await nextTick()
  return host
}

const rowTitles = sel => [...host.querySelectorAll(sel)].map(e => e.textContent.trim())
const topRows   = () => rowTitles('.mp-scroll > .mm-card .mm-row-title')
const sheet     = () => host.querySelector('.mm-pick')
const sheetRows = () => rowTitles('.mm-pick .mm-row-title')
const groupRows = () => [...host.querySelectorAll('.mm-axis-row')]
const invRow    = name => [...host.querySelectorAll('.item-row')]
  .find(r => r.querySelector('.name-main')?.textContent.trim().startsWith(name))

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
async function setInput(el, value) {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  cfg.config.axisNames = ['', '']
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('データ管理 — 取り込む / 書き出す', () => {
  it('入口は「取り込む」「書き出す」の2つだけ', async () => {
    await mountPage()
    expect(topRows()).toEqual(['取り込む', '書き出す'])
    expect(sheet()).toBeNull()
  })

  it('「取り込む」を押すと、種類（品目リスト・過去の納品・過去の棚卸）を選べる', async () => {
    await mountPage()
    await click([...host.querySelectorAll('.mm-row')].find(b => b.textContent.includes('取り込む')))
    expect(sheet()).toBeTruthy()
    expect(sheetRows()).toEqual(['品目リスト', '過去の納品', '過去の棚卸'])
  })

  it('「書き出す」を押すと、品目リストと棚卸結果を選べる', async () => {
    await mountPage()
    await click([...host.querySelectorAll('.mm-row')].find(b => b.textContent.includes('書き出す')))
    expect(sheetRows()).toEqual(['品目リスト', '棚卸結果'])
  })

  it('戻る操作は、画面を閉じる前にシートを閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mountPage()
    await click([...host.querySelectorAll('.mm-row')].find(b => b.textContent.includes('取り込む')))
    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(sheet()).toBeNull()
  })
})

describe('データ管理 — 並び順設定（グループ）', () => {
  it('ジャンルも取込元由来のグループとして、自作より先に並ぶ', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    const labels = groupRows().map(r => [
      r.querySelector('.mm-axis-label').textContent.trim(),
      r.querySelector('.mm-axis-name')?.textContent.trim() ?? '',
    ])
    expect(labels[0]).toEqual(['グループ1', 'ジャンル別'])
    expect(labels[1]).toEqual(['グループ2', '保管場所'])
    // ジャンルは名前も中身も編集できない
    expect(groupRows()[0].querySelector('.mm-axis-edit')).toBeNull()
    expect(groupRows()[0].querySelector('.mm-axis-del')).toBeNull()
    expect(groupRows()[0].querySelector('.mm-axis-fixed').textContent).toContain('取込元由来')
  })

  it('ジャンルが無い店では、自作の1つ目がグループ1になる', async () => {
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '', '個')      // ジャンルなし
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    const first = groupRows()[0]
    expect(first.querySelector('.mm-axis-label').textContent.trim()).toBe('グループ1')
    expect(first.querySelector('.mm-axis-name').textContent.trim()).toBe('保管場所')
  })

  it('見出しは「並び順設定」で、追加は「グループを追加」', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    expect(host.textContent).toContain('並び順設定')
    expect(host.querySelector('.mm-axis-add').textContent).toContain('グループを追加')
  })
})

describe('データ管理 — 品目一覧はその場で設定できる', () => {
  it('畳まずに常に出ている', async () => {
    await mountPage()
    expect(host.querySelector('.mm-preview')).toBeTruthy()
    expect(host.querySelectorAll('.item-row').length).toBeGreaterThan(0)
  })

  it('数量は打てない（数量の入力欄を持たない）', async () => {
    await mountPage()
    expect(host.querySelector('.qty-display')).toBeNull()
    expect(invRow('トマト').querySelector('.mm-set')).toBeTruthy()
  })

  it('発注点を打つとその場で保存される', async () => {
    await mountPage()
    const input = invRow('トマト').querySelectorAll('.mm-set-input')[0]
    await setInput(input, '3')
    expect(cfg.config.reorderPoints['トマト']).toBe(3)
  })

  it('目標（補充してここまで戻す数）を打つとその場で保存される', async () => {
    await mountPage()
    const input = invRow('トマト').querySelectorAll('.mm-set-input')[1]
    await setInput(input, '12')
    expect(cfg.config.replenishTargets['トマト']).toBe(12)
  })

  it('空にすると設定が解除される（自動算出へ戻る）', async () => {
    cfg.setReorderPoint('トマト', 3)
    await mountPage()
    await setInput(invRow('トマト').querySelectorAll('.mm-set-input')[0], '')
    expect(cfg.config.reorderPoints['トマト']).toBeUndefined()
  })

  it('表に出す / 出さないをその場で切り替えられる', async () => {
    await mountPage()
    const eye = () => invRow('豚バラ').querySelector('.mm-set-eye')
    expect(eye().textContent.trim()).toBe('出す')
    await click(eye())
    expect(cfg.config.hiddenItems).toContain('豚バラ')
    expect(eye().textContent.trim()).toBe('出さない')
    await click(eye())
    expect(cfg.config.hiddenItems).not.toContain('豚バラ')
  })

  it('非表示にした品目もこの表からは消えない（戻せなくなるため）', async () => {
    cfg.hideItem('豚バラ')
    await mountPage()
    expect(invRow('豚バラ')).toBeTruthy()
  })

  it('振り分け先は品目名の下に出る（数量欄を設定に明け渡しても失わない）', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.addAxisGroup(0, '冷蔵庫')
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    await mountPage()
    // 既定の並び替えはジャンル。ジャンル名がヒントに出る
    expect(invRow('トマト').querySelector('.group-hint').textContent.trim()).toBe('野菜')
  })
})
