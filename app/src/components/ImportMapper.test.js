/**
 * 列指定の画面そのもの。
 *
 * ここで確かめたいのは「問いの順番が固定されていること」と「決めたことが
 * 元データの上に色で書かれること」。ファイルの形で問いの形が変わると、
 * 使うたびに「今回はどの画面だっけ」から始めることになる。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { saveRecipe, fingerprintTable } from '../composables/importRecipes.js'

let app = null, host = null, events = null

async function mount(csvText, filename = 'shiire.csv') {
  const { default: Mapper } = await import('./ImportMapper.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  events = { imported: [], close: [] }
  app = createApp({
    render: () => h(Mapper, {
      csvText, filename, axisNames: ['', ''],
      onImported: (p) => events.imported.push(p),
      onClose: () => events.close.push(true),
    }),
  })
  app.mount(host)
  await nextTick()
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await nextTick() }
const qText = () => host.querySelector('.imp-q')?.textContent.trim() ?? ''
const btn = (t) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(t))
// 実機と同じく**セルを押す**（行の余白ではなく）。セルは行を覆っているので、
// ここで止まると行のタップが届かない
const tapHeadRow = (ri) =>
  host.querySelectorAll('.peek.headerRow .peek-row')[ri].querySelectorAll('.peek-c')[0].click()

beforeEach(() => localStorage.clear())
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

const HEADED = '商品ｺｰﾄﾞ,商品名,単位,仕入単価\n12687,サラダ用カップ,個,20\n12690,コーヒー豆,kg,1800'
const BARE   = 'トマト,箱,120\nレタス,玉,80'

describe('問いは順番が固定されている', () => {
  it('どんなファイルでも、最初の問いは「見出しの行」', async () => {
    await mount(HEADED)
    expect(qText()).toContain('見出しの行を選んでください')
    await mount(BARE)
    expect(qText()).toContain('見出しの行を選んでください')
  })

  it('見出しの行を選ぶと、半角カナの見出しからでも列が当たってマッピング面へ進む', async () => {
    await mount(HEADED)
    tapHeadRow(0)
    await settle()
    expect(host.querySelector('.imp-q')).toBeNull()          // 問いは終わっている
    const labels = [...host.querySelectorAll('.peek-head .mc-f')].map(e => e.textContent.trim())
    expect(labels).toEqual(['商品コード', '品目名', '単位', '単価'])
  })

  it('見出しが無ければ、続けて「最初の品目名」を訊く', async () => {
    await mount(BARE)
    btn('見出しの行はありません').click()
    await settle()
    expect(qText()).toContain('最初の品目名')

    // 1つのセルで「品目名の列」と「データの開始行」が同時に決まる
    host.querySelectorAll('.peek.firstItem .peek-row')[0].querySelectorAll('.peek-c')[0].click()
    await settle()
    expect(host.querySelector('.imp-q')).toBeNull()
    expect(host.textContent).toContain('2件が入ります')
  })

  it('見出しの選び直しができる', async () => {
    await mount(HEADED)
    tapHeadRow(0)
    await settle()
    btn('変える').click()
    await settle()
    expect(qText()).toContain('見出しの行を選んでください')
  })
})

describe('マッピング面', () => {
  it('列をタップすると項目を選べ、選んだ色がその列に付く', async () => {
    await mount(BARE)
    btn('見出しの行はありません').click(); await settle()
    host.querySelectorAll('.peek.firstItem .peek-row')[0].querySelectorAll('.peek-c')[0].click()
    await settle()

    const head = [...host.querySelectorAll('.peek.mapped .peek-head .peek-c')]
    head[2].click(); await settle(2)
    expect(host.querySelector('.fbar-t').textContent).toContain('列3')
    ;[...host.querySelectorAll('.fbar .fchip')].find(b => b.textContent.startsWith('単価')).click()
    await settle()

    const col2 = [...host.querySelectorAll('.peek.mapped .peek-head .peek-c')][2]
    expect(col2.classList.contains('mapped')).toBe(true)
    expect(col2.querySelector('.mc-f').textContent.trim()).toBe('単価')
  })

  it('取り込むと、読み方をレシピにできる形で渡す', async () => {
    await mount(HEADED)
    tapHeadRow(0)
    await settle()
    host.querySelector('.imp-go').click()
    await settle()

    expect(events.imported).toHaveLength(1)
    const p = events.imported[0]
    expect(p.headerRow).toBe(0)
    expect(p.headerNamed).toBe(true)
    expect(p.mapping.name).toBe(1)
    // 列は番号だけでなく見出しの名前も控える（来月列が動いても追えるように）
    expect(p.recipeShape.columns).toContainEqual({ field: 'name', col: 1, head: '商品名' })
  })
})

describe('レシピが当たったとき', () => {
  it('問いを1つも出さず、当たったことを画面に書く', async () => {
    saveRecipe({
      name: '仕入先マスタ', kind: 'table',
      fp: fingerprintTable([{ cols: ['商品ｺｰﾄﾞ', '商品名', '単位', '仕入単価'] }], 0),
      headerRow: 0, headerNamed: true,
      columns: [{ field: 'name', col: 1, head: '商品名' }, { field: 'price', col: 3, head: '仕入単価' }],
    })
    await mount(HEADED)
    await settle()
    expect(host.querySelector('.imp-q')).toBeNull()
    expect(host.textContent).toContain('レシピ「仕入先マスタ」で読みました')
  })

  it('違っていれば「使わない」で、いつもの問いに戻せる', async () => {
    saveRecipe({
      name: 'ちがうレシピ', kind: 'table',
      fp: fingerprintTable([{ cols: ['商品ｺｰﾄﾞ', '商品名', '単位', '仕入単価'] }], 0),
      headerRow: 0, headerNamed: true,
      columns: [{ field: 'name', col: 1, head: '商品名' }],
    })
    await mount(HEADED)
    await settle()
    btn('使わない').click()
    await settle()
    expect(qText()).toContain('見出しの行を選んでください')
  })
})
