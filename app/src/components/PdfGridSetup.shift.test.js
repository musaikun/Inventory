/**
 * 表の直し方。**ずれている場所をタップしてから**、どう直すかを選ぶ。
 *
 * 直し方のボタンを常に並べておくのをやめた。「1行が2行に割れている」
 * 「2行が1行にくっついている」を常時出していたときは、どちらが自分の紙の話なのかを
 * 画面の前で考えることになり、そこで止まっていた（しかも向きが逆に配線されていた）。
 * 先に場所を指させば、あとは「それをどうしたいか」だけを選べばよくなる。
 *
 * ずれ自体も目で探させない。全行出して、そろっていない行に印を付ける。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const t = (text, x, y, w) => ({ text, x, y, w: w ?? text.length * 6, h: 10 })

// 「牛乳 1L」だけ名前が2つに割れ、単価が無い紙
const TOKENS = [
  t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
  t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
  t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
  t('牛乳', 30, 690), t('1L', 60, 690), t('本', 150, 690),
  t('人参', 30, 670), t('本', 150, 670), t('90', 230, 670),
  t('白菜', 30, 650), t('玉', 150, 650), t('200', 230, 650),
]
const PAGE = { rotate: 0, tokens: TOKENS }

// 「人参」だけ、名前と値が 8 離れた2行に割れている紙
const SPLIT = { rotate: 0, tokens: [
  t('品名', 30, 750), t('単位', 150, 750), t('単価', 230, 750),
  t('豚バラ', 30, 730), t('kg', 150, 730), t('1200', 230, 730),
  t('キャベツ', 30, 710), t('玉', 150, 710), t('280', 230, 710),
  t('人参', 30, 690), t('本', 150, 682), t('90', 230, 682),
  t('白菜', 30, 650), t('玉', 150, 650), t('200', 230, 650),
]}

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
          items: TOKENS.map(k => ({ str: k.text, width: k.w, height: 10, transform: [1, 0, 0, 1, k.x, k.y] })),
        }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, ready = []

const button = (txt) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(txt))
const trs = () => [...host.querySelectorAll('.gs-table tbody tr')]
const bodyRows = () => trs().map(tr => [...tr.children].slice(1).map(td => td.textContent.trim()))
const rowNos = () => trs().map(tr => tr.querySelector('.gs-no').textContent.trim())
/** 表のセルをタップする（行・列とも0始まり。先頭の行番号の列は飛ばす） */
const tapCell = (row, col) => trs()[row].children[col + 1].click()

async function mount(pages = [PAGE]) {
  const { default: PdfGridSetup } = await import('./PdfGridSetup.vue')
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfGridSetup, { file, pages, onReady: (p) => ready.push(p), onClose: () => {} }),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
  button('次へ').click()
  await nextTick()
}

beforeEach(() => { ready = [] })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.resetModules() })

describe('PdfGridSetup — ずれを見つける', () => {
  it('行は全部出す（先頭だけ見せると、後ろのページのずれに気づけない）', async () => {
    await mount()
    expect(bodyRows().length).toBe(6)
  })

  it('値の欠けた行に印を付け、件数を出す', async () => {
    await mount()
    expect(host.textContent).toContain('そろっていない行 1件')
    expect(trs().map(tr => tr.className.includes('odd')))
      .toEqual([false, false, false, true, false, false])
  })

  it('その行だけを見られる（行番号は全体の何行目かのまま）', async () => {
    await mount()
    button('そろっていない行').click()
    await nextTick()
    expect(bodyRows().length).toBe(1)
    expect(rowNos()).toEqual(['4'])
  })
})

describe('PdfGridSetup — 直し方はセルから選ぶ', () => {
  it('直し方のボタンは常設しない（案内はタップの一言だけ）', async () => {
    await mount()
    expect(host.textContent).toContain('そのセルをタップ')
    expect(button('1つの品目が2行に割れている')).toBeUndefined()
    expect(button('この値は左の列のもの')).toBeUndefined()
  })

  it('セルをタップすると、その場所と直し方が出る', async () => {
    await mount()
    tapCell(1, 1)          // 2行目2列目「kg」
    await nextTick()
    expect(host.querySelector('.gs-fix-t').textContent).toContain('2行目 2列目')
    expect(host.querySelector('.gs-fix-t').textContent).toContain('kg')
    expect(button('この値は左の列のもの')).not.toBeUndefined()
  })

  it('もう一度同じセルをタップすると閉じる', async () => {
    await mount()
    tapCell(1, 1)
    await nextTick()
    tapCell(1, 1)
    await nextTick()
    expect(host.querySelector('.gs-fix')).toBe(null)
  })

  it('「この値は左の列のもの」で列が合わさる', async () => {
    await mount()
    tapCell(1, 1)
    await nextTick()
    button('この値は左の列のもの').click()
    await nextTick()
    expect(host.textContent).toContain('全 6行 / 2列')
    expect(bodyRows()[1]).toEqual(['豚バラ kg', '1200'])
  })

  it('1列目では「左の列のもの」は押せない', async () => {
    await mount()
    tapCell(1, 0)
    await nextTick()
    expect(button('この値は左の列のもの').disabled).toBe(true)
  })

  it('直したら選択は閉じる（結果がすぐ見える）', async () => {
    await mount()
    tapCell(1, 1)
    await nextTick()
    button('この値は左の列のもの').click()
    await nextTick()
    expect(host.querySelector('.gs-fix')).toBe(null)
  })
})

describe('PdfGridSetup — 行の高さの向き', () => {
  it('「2行に割れている」で行がまとまる（以前は逆に配線されていた）', async () => {
    await mount([SPLIT])
    // 人参の名前と値が別の行になっている
    expect(bodyRows().length).toBe(6)
    expect(bodyRows()[3]).toEqual(['人参', '', ''])

    tapCell(3, 0)
    await nextTick()
    button('1つの品目が2行に割れている').click()
    await nextTick()
    tapCell(3, 0)
    await nextTick()
    button('1つの品目が2行に割れている').click()
    await nextTick()

    expect(bodyRows().length).toBe(5)
    expect(bodyRows()[3]).toEqual(['人参', '本', '90'])
  })

  it('「1行になっている」は逆向きに効く（戻せる）', async () => {
    await mount([SPLIT])
    const press = async (label) => {
      tapCell(3, 0)
      await nextTick()
      button(label).click()
      await nextTick()
    }
    await press('1つの品目が2行に割れている')
    await press('1つの品目が2行に割れている')
    expect(bodyRows().length).toBe(5)
    await press('2つの品目が1行になっている')
    expect(bodyRows().length).toBe(6)
  })
})
