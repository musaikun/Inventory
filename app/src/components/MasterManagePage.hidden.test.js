// データ管理の非表示の品目。設定済み品目一覧のチップ（非表示設定品目・非表示にした順）で見る。
// 誤って隠した品目を探して戻す場所なので、「非表示にした順」では最後に隠したものが先頭に来て、
// 隠した時刻が読めることを固定する。
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

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
const seg = label => [...host.querySelectorAll('.mm-page .sort-chip')].find(b => b.textContent.trim() === label)

async function mountPage() {
  const { default: Page } = await import('./MasterManagePage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Page)
  app.mount(host)
  await nextTick()
  await click(host.querySelector('.mm-listopen'))
  return host
}

function touch(type, x, y = 100) {
  const ev = new Event(type, { bubbles: true })
  ev.changedTouches = [{ clientX: x, clientY: y }]
  return ev
}
async function swipe(dx) {
  const el = host.querySelector('.mm-page .inventory-section')
  el.dispatchEvent(touch('touchstart', 200))
  el.dispatchEvent(touch('touchmove', 200 + dx / 2))
  el.dispatchEvent(touch('touchend', 200 + dx))
  await nextTick()
}
const activeTab = () => host.querySelector('.mm-page .sort-chip.active')?.textContent.trim()

const rows  = () => [...host.querySelectorAll('.mm-page .item-row')]
const names = () => rows().map(r => r.dataset.item)

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

describe('MasterManagePage — 非表示の品目（設定済み品目一覧のタブ）', () => {
  it('データ管理の画面に別の「非表示中」ブロックは無い', async () => {
    await mountPage()
    const titles = [...host.querySelectorAll('.mm-block-title')].map(e => e.textContent.trim())
    expect(titles).not.toContain('非表示中')
  })

  it('チップは ジャンル → 作ったグループ → 非表示設定品目 → 非表示にした順（タブは出さない）', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.setAxisName(1, '仕入先')
    await mountPage()
    const labels = [...host.querySelectorAll('.mm-page .sort-chip')].map(b => b.textContent.trim())
    expect(labels).toEqual(['ジャンル', '保管場所', '仕入先', '非表示設定品目', '非表示にした順'])
    expect(seg('ジャンル').classList.contains('active')).toBe(true)
    expect(host.querySelector('.mm-page .seg-btn')).toBeNull()
  })

  it('作ったグループは「設定済みグループ」の枠の中で切り替える', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.setAxisName(1, '仕入先')
    await mountPage()
    const box = host.querySelector('.mm-page .sort-chip-box')
    expect(box.textContent).toContain('設定済みグループ')
    expect([...box.querySelectorAll('.sort-chip')].map(b => b.textContent.trim())).toEqual(['保管場所', '仕入先'])
    await click(seg('仕入先'))
    expect(activeTab()).toBe('仕入先')
  })

  it('作ったグループが無ければ枠を出さない', async () => {
    await mountPage()
    expect(host.querySelector('.mm-page .sort-chip-box')).toBeNull()
  })

  it('非表示設定品目: 非表示の品目だけが、取込由来のジャンル別に出る', async () => {
    cfg.addItem('牛肉', 100, '肉', '個')
    cfg.hideItem('なす')
    cfg.hideItem('トマト')
    cfg.hideItem('牛肉')
    await mountPage()
    await click(seg('非表示設定品目'))
    const heads = [...host.querySelectorAll('.mm-page .group-header-row')]
      .map(e => e.textContent)
    expect(heads.some(t => t.includes('野菜'))).toBe(true)
    expect(heads.some(t => t.includes('肉'))).toBe(true)
    await click(host.querySelector('.mm-page .thead-toggle'))   // すべて開く
    expect(names()).toEqual(['牛肉', 'トマト', 'なす'])   // ジャンルのチップと同じ並び（コード無しは五十音）
  })

  it('非表示にした順: 最後に隠した品目が先頭に並び、時刻が出る', async () => {
    cfg.hideItem('トマト')
    cfg.config.hiddenAt['トマト'] = '2026-09-05T10:00:00.000Z'
    cfg.hideItem('レタス')   // 時刻は「いま」
    await mountPage()
    await click(seg('非表示にした順'))

    expect(names()).toEqual(['レタス', 'トマト'])
    expect(rows()[0].textContent).toMatch(/今日 \d+:\d{2} に非表示/)
    expect(rows()[1].textContent).toMatch(/9\/5 \d+:\d{2} に非表示/)
  })

  it('非表示の品目が無ければ言葉で出す', async () => {
    await mountPage()
    await click(seg('非表示にした順'))
    expect(rows()).toHaveLength(0)
    expect(host.querySelector('.mm-page').textContent).toContain('非表示の品目はありません')
  })

  it('ジャンルのタブでは非表示の品目も表から消えない（戻せなくなるため）', async () => {
    cfg.hideItem('トマト')
    await mountPage()
    expect(host.querySelector('.mm-page [data-item="トマト"]')).toBeTruthy()
  })

  it('左右にスワイプでタブが隣へ移り、端では止まる', async () => {
    cfg.setAxisName(0, '保管場所')
    cfg.hideItem('トマト')
    await mountPage()
    expect(activeTab()).toBe('ジャンル')
    await swipe(80)                       // 右へ払う＝左隣。先頭なので動かない
    expect(activeTab()).toBe('ジャンル')
    await swipe(-80)
    expect(activeTab()).toBe('保管場所')
    await swipe(-80)
    await swipe(-80)
    expect(activeTab()).toBe('非表示にした順')
    expect(names()).toEqual(['トマト'])
    await swipe(-80)                      // 末尾なので動かない
    expect(activeTab()).toBe('非表示にした順')
    await swipe(80)
    expect(activeTab()).toBe('非表示設定品目')
  })

  it('短い横移動や縦スクロールではタブは変わらない', async () => {
    await mountPage()
    await swipe(-20)
    expect(activeTab()).toBe('ジャンル')
    const el = host.querySelector('.mm-page .inventory-section')
    el.dispatchEvent(touch('touchstart', 200, 100))
    el.dispatchEvent(touch('touchmove', 190, 200))
    el.dispatchEvent(touch('touchend', 140, 400))
    await nextTick()
    expect(activeTab()).toBe('ジャンル')
  })
})

describe('MasterManagePage — 設定済み品目一覧の件数', () => {
  it('全体・表示中・非表示（うち自動）・ジャンルなしを出す', async () => {
    cfg.addItem('塩', 100, '', '個')
    cfg.hideItem('トマト')
    cfg.hideItem('塩', true)
    await mountPage()
    const stat = label => [...host.querySelectorAll('.mm-page .mm-stat')]
      .find(e => e.querySelector('.mm-stat-label').textContent === label)
    expect(stat('全体の品目').querySelector('.mm-stat-num').textContent).toBe('4')
    expect(stat('表示中').querySelector('.mm-stat-num').textContent).toBe('2')
    expect(stat('非表示').querySelector('.mm-stat-num').textContent).toBe('2')
    expect(stat('非表示').textContent).toContain('うち自動 1')
    expect(stat('ジャンルなし').querySelector('.mm-stat-num').textContent).toBe('1')
  })
})

describe('MasterManagePage — 取込で除外した行', () => {
  it('直近の取込で品目にしなかった行を件数で出し、押すと理由つきで開く', async () => {
    cfg.loadFromCSV('品目名,単位\nキャベツ,玉\n小計,\nキャベツ,玉')
    expect(cfg.config.importExcluded.total).toBe(2)
    await mountPage()
    const tile = host.querySelector('.mm-page .mm-stat.excluded')
    expect(tile.querySelector('.mm-stat-num').textContent).toBe('2')
    expect(host.querySelector('.mm-page .mm-excluded')).toBeNull()
    await click(tile)
    const rows = [...host.querySelectorAll('.mm-page .mm-excluded-row')].map(r => r.textContent)
    expect(rows[0]).toContain('小計')
    expect(rows[0]).toContain('合計・小計')
    expect(rows[1]).toContain('キャベツ')
    expect(rows[1]).toContain('重複')
  })

  it('取込の記録が無ければ0で、押せない', async () => {
    await mountPage()
    const tile = host.querySelector('.mm-page .mm-stat.excluded')
    expect(tile.querySelector('.mm-stat-num').textContent).toBe('0')
    expect(tile.disabled).toBe(true)
  })

  it('全品目を削除すると記録も消える', async () => {
    cfg.loadFromCSV('品目名,単位\n小計,\nキャベツ,玉')
    cfg.setEmptyList()
    expect(cfg.config.importExcluded).toBeNull()
  })
})
