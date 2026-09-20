/**
 * PDFを表にする画面の進み方（下の 戻る / 次へ）と、枚数・割り方の見せ方。
 *
 * 以前は枚数のボタンを押すこと自体が「次へ」だった。自動判定が選択済みに見えるので、
 * **すでに選ばれているものをもう一度押さないと進めない**状態になっていて、
 * 最初の一歩でつまずく。押す＝選ぶ、進む＝次へ に分けたことをここで固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6, h: 10 })

// 縦に2枚積まれた紙（上 y=750.. / 下 y=640..）
const STACKED = [
  t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
  t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
  t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
  t('品名', 30, 640), t('単位', 150, 640), t('単価', 230, 640),
  t('人参', 30, 620), t('本', 150, 620), t('90', 230, 620),
  t('白菜', 30, 600), t('玉', 150, 600), t('200', 230, 600),
]

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      destroy: () => {},
      getPage: async () => ({
        rotate: 0,
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({
          items: STACKED.map(k => ({ str: k.text, width: k.w, height: 10, transform: [1, 0, 0, 1, k.x, k.y] })),
        }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, ready = [], closed = 0

const button = (txt) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(txt))
const nums   = () => [...host.querySelectorAll('.gs-num')]
const fig    = () => host.querySelector('.gs-fig')

async function waitFor(cond, label = '条件') {
  for (let i = 0; i < 400; i++) {
    if (cond()) return
    await nextTick()
    if (i % 20 === 19) await new Promise(r => setTimeout(r, 0))
  }
  throw new Error(label + ' が満たされませんでした')
}

async function mount(initial = null, pages = [{ tokens: STACKED, rotate: 0 }]) {
  const { default: PdfGridSetup } = await import('./PdfGridSetup.vue')
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfGridSetup, {
      file, pages, initial,
      onReady: (p) => ready.push(p),
      onClose: () => { closed++ },
    }),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
}

beforeEach(() => { ready = []; closed = 0 })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('PdfGridSetup — 進み方', () => {
  it('枚数を押しても進まない。次へで進む', async () => {
    await mount()
    nums()[0].click()
    await nextTick()
    expect(host.textContent).toContain('1ページの中に、同じ形の表がいくつありますか？')
    button('次へ').click()
    await nextTick()
    expect(host.textContent).not.toContain('1ページの中に、同じ形の表がいくつありますか？')
    expect(host.textContent).toContain('豚バラ')
  })

  it('戻るで枚数の段階に帰れる（選んだ枚数は残る）', async () => {
    await mount()
    nums()[2].click()      // 3枚
    await nextTick()
    button('次へ').click()
    await nextTick()
    button('戻る').click()
    await nextTick()
    expect(host.textContent).toContain('1ページの中に、同じ形の表がいくつありますか？')
    expect(nums()[2].className).toContain('on')
  })

  it('最初の段階の左は「やめる」で閉じる（戻り先が無いのに戻ると書かない）', async () => {
    await mount()
    expect(button('戻る')).toBeUndefined()
    button('やめる').click()
    expect(closed).toBe(1)
  })

  it('いまどこにいるかを出す', async () => {
    await mount()
    expect(host.querySelector('.gs-foot-step').textContent).toContain('1 / 2')
    button('次へ').click()
    await nextTick()
    expect(host.querySelector('.gs-foot-step').textContent).toContain('2 / 2')
  })

  it('進めないときは理由を出す（押せないだけだと手が止まる）', async () => {
    await mount(null, [])   // 表にできる文字が無い紙
    button('次へ').click()
    await waitFor(() => !!host.querySelector('.gs-foot-why'), '進めない理由')
    expect(host.querySelector('.gs-foot-why').textContent.length).toBeGreaterThan(0)
    expect(button('この表で進む').disabled).toBe(true)
  })
})

describe('PdfGridSetup — 枚数と割り方', () => {
  it('9枚まで選べる', async () => {
    await mount()
    expect(nums().length).toBe(9)
  })

  it('紙から枚数と割り方を見当てて、選択済みにしておく', async () => {
    await mount()
    await waitFor(() => host.textContent.includes('自動判定'), '自動判定')
    expect(nums()[1].className).toContain('on')          // 2枚
    expect(fig().textContent).toContain('横1 × 縦2')      // 縦に積まれている
  })

  it('図をタップすると割り方の候補が切り替わる（自動が外れたときの逃げ道）', async () => {
    await mount()
    await waitFor(() => fig().textContent.includes('横1 × 縦2'), '縦2')
    fig().click()
    await nextTick()
    expect(fig().textContent).toContain('横2 × 縦1')
    fig().click()
    await nextTick()
    expect(fig().textContent).toContain('横1 × 縦2')      // 一周して戻る
  })

  it('1枚のときは切り替える先が無いので図は押せない', async () => {
    await mount()
    nums()[0].click()
    await nextTick()
    expect(fig().disabled).toBe(true)
    expect(fig().textContent).toContain('横1 × 縦1')
  })

  it('縦に積まれた表は上から下へ続けて読む', async () => {
    await mount()
    await waitFor(() => fig().textContent.includes('横1 × 縦2'), '縦2')
    button('次へ').click()
    await nextTick()
    const first = [...host.querySelectorAll('.gs-table tbody tr')]
      .map(tr => tr.children[1]?.textContent.trim())
    expect(first).toEqual(['品名', '豚バラ', 'キャベツ', '品名', '人参', '白菜'])
  })

  it('割り方は作り方として渡る（次に同じ紙が来たら訊かない）', async () => {
    await mount()
    await waitFor(() => fig().textContent.includes('横1 × 縦2'), '縦2')
    button('次へ').click()
    await nextTick()
    button('この表で進む').click()
    await nextTick()
    expect(ready.length).toBe(1)
    expect(ready[0].grid.layout).toEqual({ cols: 1, rows: 2 })
    expect(ready[0].grid.sections).toBe(1)     // layout を知らない古い読み手向け
  })

  it('覚えているレシピがあるときは枚数を訊かない', async () => {
    await mount({ layout: { cols: 1, rows: 2 }, rowFactor: 0.5, edges: [] })
    expect(host.textContent).not.toContain('1ページの中に、同じ形の表がいくつありますか？')
    expect(host.textContent).toContain('豚バラ')
    expect(button('戻る')).toBeUndefined()      // 訊かれていないので戻り先も無い
  })
})
