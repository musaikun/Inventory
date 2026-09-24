// データ管理の作り直し（2026-09-15）。
//   - 取り込む / 書き出す の入口を1つずつにし、押してから種類を選ぶ
//   - 並び順は「グループ」で数える。ジャンルも取込元由来のグループとして同じ列に並ぶ
//   - 2026-09-23: 品目一覧は常設をやめ「設定済み品目一覧」のボタンから別ページで開く
//   - 2026-09-24: 設定済み品目一覧は確認用にする（発注点・目標・出す/出さないの欄を外す）
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

// 設定済み品目一覧のページを開く
async function openList() {
  await click(host.querySelector('.mm-listopen'))
}

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

/**
 * 品目リスト整理はカード1枚だけにする（User指示 2026-09-21）。
 *
 * グループの行・追加欄をこの画面から外し、**開いた先で作る**ようにした。
 * 設定する場所と使う場所が離れていると、作りに戻って、また開き直して、の往復になる。
 */
describe('データ管理 — 品目リスト整理', () => {
  it('カード1枚だけ。グループの行も追加欄もここには無い', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    expect(host.textContent).toContain('品目リスト整理')
    expect(host.querySelectorAll('.mm-organize:not(.mm-listopen)').length).toBe(1)
    expect(host.querySelector('.mm-organize').textContent).toContain('グループ化・並び替え')
    expect(host.querySelectorAll('.mm-axis-row').length).toBe(0)
    expect(host.querySelector('.mm-axis-add')).toBeNull()
    expect(host.querySelector('.mm-axis-go')).toBeNull()
  })

  it('いま何でまとめているかをカードに出す（ジャンルも同格に並べる）', async () => {
    cfg.setAxisName(0, '保管場所')
    await mountPage()
    const sub = host.querySelector('.mm-organize-sub').textContent
    expect(sub).toContain('ジャンル別')
    expect(sub).toContain('保管場所')
  })

  it('まとめ方がまだ無いときは、作るところからだと分かる', async () => {
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '', '個')      // ジャンルなし・グループなし
    await mountPage()
    expect(host.querySelector('.mm-organize-sub').textContent).toContain('グループを作って')
  })
})

describe('データ管理 — 設定済み品目一覧（確認用）', () => {
  it('最初は出ておらず、ボタンで別ページとして開き、戻るで閉じる', async () => {
    await mountPage()
    expect(host.querySelector('.mm-page')).toBeNull()
    expect(host.querySelectorAll('.item-row').length).toBe(0)
    await openList()
    expect(host.querySelector('.mm-page')).toBeTruthy()
    expect(host.querySelectorAll('.mm-page .item-row').length).toBe(2)
    await click(host.querySelector('.mm-page .mp-back'))
    expect(host.querySelector('.mm-page')).toBeNull()
  })

  it('端末の戻るでもページだけが閉じる（データ管理には残る）', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mountPage()
    await openList()
    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(host.querySelector('.mm-page')).toBeNull()
    expect(consumeInnerLayerBack()).toBe(false)
  })

  it('確認用で、数量・発注点・目標・出す/出さないの欄を持たない', async () => {
    await mountPage()
    await openList()
    expect(host.querySelector('.mm-page .qty-display')).toBeNull()
    expect(host.querySelector('.mm-page input')).toBeNull()
    expect(host.querySelector('.mm-page .mm-set-eye')).toBeNull()
    expect(host.querySelector('.mm-page').textContent).not.toContain('発注点')
  })

  it('非表示にした品目もジャンルの表からは消えない', async () => {
    cfg.hideItem('豚バラ')
    await mountPage()
    await openList()
    expect(invRow('豚バラ')).toBeTruthy()
  })

  it('振り分け先は右の欄にチップで出る', async () => {
    await mountPage()
    await openList()
    // 既定の並び替えはジャンル。ジャンル名がチップで出る
    expect(invRow('トマト').querySelector('.preview-group-chip').textContent.trim()).toBe('野菜')
  })
})
