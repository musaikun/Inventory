/**
 * 紙を指で見る（スワイプでページ送り・2本指で拡大）。
 *
 * ここを守りたい理由は、列指定の画面が「紙の上の文字をタップする」操作でできているから。
 * ページを送る指と、列を選ぶ指が同じ面の上にあるので、取り違えると**触っていない列が
 * 選ばれる**（いちばん直りにくい種類の不具合になる）。so:
 *   - 縦に動かしたときはページを送らない（スクロールのつもりなので）
 *   - 拡大中はページを送らない（紙を動かしたいので）
 *   - ジェスチャの直後のclickは1回だけ捨てる
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const TOKENS = [{ text: '品名', x: 30, y: 750, w: 18 }]

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      destroy: () => {},
      getPage: async () => ({
        rotate: 0,
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({
          items: TOKENS.map(t => ({ str: t.text, width: t.w, height: 10, transform: [1, 0, 0, 1, t.x, t.y] })),
        }),
      }),
    }),
  }),
  Util: { transform: (a, b) => [b[0], b[1], b[2], b[3], b[4], 800 - b[5]] },
}))

let app = null, host = null, overlayTaps = 0

async function mount() {
  const { default: PdfPageViewer } = await import('./PdfPageViewer.vue')
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  file.arrayBuffer = async () => new ArrayBuffer(8)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(PdfPageViewer, { file }, {
      overlay: () => h('button', { class: 'ov-hit', onClick: () => { overlayTaps++ } }, 'x'),
    }),
  })
  app.mount(host)
  // PDFを開くまでに await が何段も挟まる。回数で待つと台数の速さに左右されるので状態で待つ
  await waitFor(() => host.querySelector('.page-nav').textContent.includes('/'))
}

// 条件が満たされるまで微小に待つ（CI と手元で待ち時間が変わるため）
async function waitFor(cond, label = '条件') {
  for (let i = 0; i < 400; i++) {
    if (cond()) return
    await nextTick()
    if (i % 20 === 19) await new Promise(r => setTimeout(r, 0))
  }
  throw new Error(label + ' が満たされませんでした')
}

beforeEach(() => { overlayTaps = 0 })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

const wrap  = () => host.querySelector('.pdf-wrap')
const stage = () => host.querySelector('.pdf-stage')
const pageLabel = () => host.querySelector('.page-nav span').textContent.trim()
const zoomLabel = () => host.querySelector('.zoom-nav span').textContent.trim()

// jsdom には TouchEvent が無い。touches / changedTouches を載せた素のEventで代える
function touch(el, type, points) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const list = points.map(p => ({ clientX: p[0], clientY: p[1] }))
  e.touches = list
  e.changedTouches = list
  el.dispatchEvent(e)
  return e
}

async function swipe(dx, dy = 0, steps = 3) {
  const w = wrap()
  touch(w, 'touchstart', [[200, 200]])
  for (let i = 1; i <= steps; i++) {
    touch(w, 'touchmove', [[200 + (dx * i) / steps, 200 + (dy * i) / steps]])
  }
  touch(w, 'touchend', [])
  await nextTick()
}

async function pinch(ratio) {
  const w = wrap()
  touch(w, 'touchstart', [[150, 200], [250, 200]])   // 100px 離れた2本
  const d = 100 * ratio
  touch(w, 'touchmove', [[200 - d / 2, 200], [200 + d / 2, 200]])
  return w
}

describe('PdfPageViewer のジェスチャ', () => {
  it('横スワイプで次のページへ送る', async () => {
    await mount()
    expect(pageLabel()).toBe('1 / 3')
    await swipe(-120)
    await waitFor(() => pageLabel() === '2 / 3', '2ページ目')
  })

  it('逆向きのスワイプで前のページへ戻る', async () => {
    await mount()
    await swipe(-120)
    await waitFor(() => pageLabel() === '2 / 3', '2ページ目')
    await swipe(120)
    await waitFor(() => pageLabel() === '1 / 3', '1ページ目')
  })

  it('少しだけ動かしたときはページを送らない（タップと取り違えない）', async () => {
    await mount()
    await swipe(-30)
    expect(pageLabel()).toBe('1 / 3')
  })

  it('縦に動かしたときはページを送らない（スクロールのつもり）', async () => {
    await mount()
    await swipe(-120, -200)
    expect(pageLabel()).toBe('1 / 3')
  })

  it('最初のページで右へ引いても戻らない', async () => {
    await mount()
    await swipe(200)
    expect(pageLabel()).toBe('1 / 3')
  })

  it('2本指を開くと拡大する', async () => {
    await mount()
    expect(zoomLabel()).toBe('100%')
    const w = await pinch(2)
    // 指が触れている間はCSSで追従する（canvasは描き直さない）
    expect(stage().style.transform).toContain('scale(2')
    touch(w, 'touchend', [])
    await waitFor(() => zoomLabel() === '200%', '200%')
    // 描き直しが済んだら見かけの拡大は畳む
    await waitFor(() => !stage().style.transform.includes('scale'), '見かけの拡大が畳まれる')
  })

  it('2本指を閉じると縮小する', async () => {
    await mount()
    const w = await pinch(0.8)
    touch(w, 'touchend', [])
    await waitFor(() => zoomLabel() === '80%', '80%')
  })

  it('拡大はボタンと同じ上限で止まる', async () => {
    await mount()
    const w = await pinch(10)
    touch(w, 'touchend', [])
    await waitFor(() => zoomLabel() === '300%', '300%')
  })

  it('拡大中は横スワイプでページを送らない（紙を指で動かすため）', async () => {
    await mount()
    const w = await pinch(2)
    touch(w, 'touchend', [])
    await waitFor(() => zoomLabel() === '200%', '200%')
    expect(wrap().style.touchAction).toBe('pan-x pan-y')
    await swipe(-150)
    expect(pageLabel()).toBe('1 / 3')
  })

  it('等倍では横をこちらで受け取る（touch-action は縦だけ渡す）', async () => {
    await mount()
    expect(wrap().style.touchAction).toBe('pan-y')
  })

  it('スワイプの直後のclickは捨てる（触っていない列が選ばれない）', async () => {
    await mount()
    await swipe(-120)
    host.querySelector('.ov-hit').click()
    expect(overlayTaps).toBe(0)
    // 捨てるのは1回だけ。次のタップは通る
    host.querySelector('.ov-hit').click()
    expect(overlayTaps).toBe(1)
  })

  it('動かしていなければタップはそのまま通る', async () => {
    await mount()
    const w = wrap()
    touch(w, 'touchstart', [[200, 200]])
    touch(w, 'touchend', [])
    await nextTick()
    host.querySelector('.ov-hit').click()
    expect(overlayTaps).toBe(1)
  })

  it('ジェスチャを取られたら引きかけを戻す（ずれたまま止まらない）', async () => {
    await mount()
    const w = wrap()
    touch(w, 'touchstart', [[200, 200]])
    touch(w, 'touchmove', [[120, 200]])
    await nextTick()
    expect(stage().style.transform).toContain('translateX')
    touch(w, 'touchcancel', [])
    await nextTick()
    expect(stage().style.transform).not.toContain('translateX')
    expect(pageLabel()).toBe('1 / 3')
  })

  it('ボタンでのページ送り・拡大は今までどおり動く', async () => {
    await mount()
    const btns = [...host.querySelectorAll('.page-nav button')]
    btns[1].click()
    await waitFor(() => pageLabel() === '2 / 3', '2ページ目')
    const zb = [...host.querySelectorAll('.zoom-nav button')]
    zb[1].click()
    await waitFor(() => zoomLabel() === '120%', '120%')
  })
})
