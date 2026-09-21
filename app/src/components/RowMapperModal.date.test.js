/**
 * 日付の列が無いファイルでも取り込めるようにする。
 *
 * 紙の納品書・棚卸表は、日付が**表の中ではなく見出しに1回しか書かれていない**。
 * 列としては取れないのに、過去データの取込は日付が必須なので、そこで詰んでいた。
 * その場で日付を入れて全行に配れば、以降は普通の日付列として扱える。
 *
 * 覚えるのは「手で入れた」という事実だけ。**日付そのものは覚えない** ── 翌月は別の日
 * なので、値を焼き付けると去年の日付で取り込んでしまう。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import RowMapperModal from './RowMapperModal.vue'
import { DELIVERY_FIELDS } from '../utils/rowMapping.js'

// 納品書を表にしたCSV（日付の列が無い）
const NO_DATE = '商品コード,商品名,数量,単価\n0100,電気掃除機,2,23000\n0110,冷蔵庫,2,125000'

let app = null, host = null, applied = []

async function mount(csvText = NO_DATE) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(RowMapperModal, {
      csvText, filename: 'nouhin.pdf', kind: 'delivery', fields: DELIVERY_FIELDS,
      onApply: (p) => applied.push(p), onClose: () => {},
    }),
  })
  app.mount(host)
  for (let i = 0; i < 6; i++) await nextTick()
}
const btn = (t) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(t))
const radio = (v) => [...host.querySelectorAll('.rm-opt input')].find(i => i.value === String(v))

async function pickHeader() {
  radio(true).click()
  for (let i = 0; i < 4; i++) await nextTick()
}
async function setMap(field, colIdx) {
  const rows = [...host.querySelectorAll('.mapping-row')]
  const row = rows.find(r => r.querySelector('.mapping-field-name').textContent.includes(field))
  const sel = row.querySelector('select')
  sel.value = String(colIdx)
  sel.dispatchEvent(new Event('change'))
  for (let i = 0; i < 3; i++) await nextTick()
}

beforeEach(() => { applied = []; localStorage.clear() })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('日付の列が無いとき', () => {
  it('日付の欄に「ここで指定」が出る', async () => {
    await mount()
    await pickHeader()
    expect(host.querySelector('.rm-fixed')).not.toBeNull()
    expect(host.querySelector('#rm-date')).not.toBeNull()
  })

  it('日付を入れれば取り込める（必須が埋まる）', async () => {
    await mount()
    await pickHeader()
    await setMap('品目名', 1)
    await setMap('数量', 2)
    expect(btn('この対応で取り込む')?.disabled ?? btn('取り込む')?.disabled).toBe(true)

    const input = host.querySelector('#rm-date')
    input.value = '2026-06-01'
    input.dispatchEvent(new Event('input'))
    for (let i = 0; i < 4; i++) await nextTick()

    const go = btn('この対応で取り込む') ?? btn('取り込む')
    expect(go.disabled).toBe(false)
    go.click()
    await nextTick()

    const lines = applied[0].csvText.split('\n')
    expect(lines[0]).toContain('日付')
    expect(lines[1]).toContain('2026-06-01')
    expect(lines[2]).toContain('2026-06-01')
  })

  it('日付を手で入れたことは覚えるが、日付そのものは覚えない', async () => {
    await mount()
    await pickHeader()
    await setMap('品目名', 1)
    await setMap('数量', 2)
    const input = host.querySelector('#rm-date')
    input.value = '2026-06-01'
    input.dispatchEvent(new Event('input'))
    for (let i = 0; i < 4; i++) await nextTick()
    ;(btn('この対応で取り込む') ?? btn('取り込む')).click()
    await nextTick()

    const shape = applied[0].recipeShape
    expect(shape.askDate).toBe(true)
    expect(JSON.stringify(shape)).not.toContain('2026-06-01')
    expect(shape.columns.some(c => c.field === 'date')).toBe(false)
  })

  it('日付の列があるファイルでは、指定の欄は出ない', async () => {
    await mount('日付,商品名,数量\n2026-06-01,トマト,3')
    await pickHeader()
    expect(host.querySelector('.rm-fixed')).toBeNull()
  })
})
