/**
 * 完了した棚卸を「アプリの見た目のまま」他の人へ渡す共有リンク（User 要件）。
 * CSV / Excel だと分類・フラグ・入力者が落ちるため、同じ画面を開くURLを配る。
 *
 * ここで固定するのは、渡す側が誤解しない条件:
 *   ・ホストにしか出さない（ゲストは自分の結果を再配布しない）
 *   ・店舗コードが無い状態で**壊れたリンクを配らせない**
 *   ・「金額は出ない」と画面に書いてあること（渡す判断がこれで決まる）
 *   ・閲覧期限が切れていたら、渡す前に警告する
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

const SID = '11111111-1111-4111-8111-111111111111'

const snapshotAt = (savedAt) => ({
  date: '2026-08-09',
  savedAt,
  sessionId: SID,
  items: [
    { item: 'トマト', qty: 8, unit: '個', unitPrice: 100, subtotal: 800, code: '', flagged: false, category: null },
  ],
  totalValue: 800,
  entryLog: ['トマト'],
  participants: null,
  flaggedItems: [],
  auditLog: [],
  activeMs: 1000,
  axisNames: ['', ''],
})

async function mount(props = {}) {
  const { default: Page } = await import('./SessionDetailPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Page, {
      snapshot: snapshotAt(new Date().toISOString()),
      isHost: true,
      shopCode: 'ABCDEF',
      ...props,
    }),
  })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

const shareBtn = () => [...host.querySelectorAll('.btn-icon')].find(b => b.title === '結果を共有')

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  for (let i = 0; i < 3; i++) await nextTick()
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
  vi.restoreAllMocks()
})

describe('結果の共有リンク', () => {
  it('ホストには共有ボタンが出る', async () => {
    await mount()
    expect(shareBtn()).toBeTruthy()
  })

  it('ゲストには出さない', async () => {
    await mount({ isHost: false })
    expect(shareBtn()).toBeFalsy()
  })

  // 店舗コードが無いまま出すと、開いても何も表示されないURLを配ることになる。
  it('店舗コードが無ければ出さない', async () => {
    await mount({ shopCode: '' })
    expect(shareBtn()).toBeFalsy()
  })

  it('押すと招待リンクと同じ形のURLと、金額が出ない旨を表示する', async () => {
    await mount()
    await click(shareBtn())

    const url = host.querySelector('.share-url-text')?.textContent ?? ''
    expect(url).toContain('?store=ABCDEF')
    expect(url).toContain(`s=${SID}`)

    const note = host.querySelector('.share-note')?.textContent ?? ''
    expect(note).toContain('単価・金額は表示されません')
  })

  it('残り日数を出す', async () => {
    await mount()
    await click(shareBtn())
    expect(host.querySelector('.share-expiry')?.textContent ?? '').toContain('あと3日')
  })

  // 期限切れのリンクを黙って配らせない。開いた相手にはエラーしか出ない。
  it('閲覧期間が終わっていたら警告する', async () => {
    const old = new Date(Date.now() - 5 * 86400_000).toISOString()
    await mount({ snapshot: snapshotAt(old) })
    await click(shareBtn())

    const expiry = host.querySelector('.share-expiry')
    expect(expiry?.className).toContain('expired')
    expect(expiry?.textContent ?? '').toContain('閲覧期間が終了しています')
  })

  it('URL行を押すとクリップボードへ入る', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    await mount()
    await click(shareBtn())
    await click(host.querySelector('.share-url-row'))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('?store=ABCDEF')
  })
})
