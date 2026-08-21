// 列指定画面（過去データ用）。品目マスタの列指定と同じ安全規約を守っているかを見る。
// 1行目の扱いを推測で確定すると、見出しの無いファイルで1行目が黙って消える。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { STOCKTAKE_FIELDS } from '../utils/rowMapping.js'

let app = null
let host = null

async function mount(csvText) {
  const { default: Modal } = await import('./RowMapperModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const applied = []
  app = createApp({
    render: () => h(Modal, {
      csvText,
      filename: 'shiire.csv',
      title: '過去の棚卸を列指定で取り込む',
      message: '過去棚卸の取込には「日付」列が必要です',
      fields: STOCKTAKE_FIELDS,
      onApply: (p) => applied.push(p),
      onClose: () => {},
    }),
  })
  app.mount(host)
  await nextTick()
  return applied
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}
function radio(labelText) {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.includes(labelText))
  return label.querySelector('input')
}
async function pick(labelText) {
  const input = radio(labelText)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}
async function mapField(fieldLabel, colIndex) {
  const row = [...host.querySelectorAll('.mapping-row')]
    .find(r => r.querySelector('.mapping-field-name')?.textContent.trim() === fieldLabel)
  if (!row) throw new Error(`mapping row not found: ${fieldLabel}`)
  const select = row.querySelector('select')
  select.value = String(colIndex)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

const HEADED = '伝票日付,商品名称,在庫数\n2026/6/1,トマト,3'
const BARE   = '2026/6/1,トマト,3\n2026/6/1,レタス,2'

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('RowMapperModal', () => {
  it('なぜ列指定になったのかを画面に出す', async () => {
    await mount(HEADED)
    expect(host.textContent).toContain('「日付」列が必要です')
  })

  it('1行目の扱いを選ぶまで取り込めない', async () => {
    await mount(HEADED)
    expect(radio('1行目は見出し').checked).toBe(false)
    expect(radio('1行目からデータ').checked).toBe(false)
    expect(button('この指定で取り込む').disabled).toBe(true)
  })

  it('見出しがあるときだけ列名から自動検出する', async () => {
    const applied = await mount(HEADED)
    await pick('1行目は見出し')
    // 日付・品目名・数量が列名から埋まり、そのまま取り込める
    expect(button('この指定で取り込む').disabled).toBe(false)
    button('この指定で取り込む').click()
    await nextTick()
    expect(applied[0].csvText.split('\n')[0]).toBe('日付,品目名,数量')
    expect(applied[0].csvText).toContain('2026/6/1,トマト,3')
  })

  it('見出し無しでは自動検出せず、必須列を指定するまで進めない', async () => {
    const applied = await mount(BARE)
    await pick('1行目からデータ')
    expect(button('この指定で取り込む').disabled).toBe(true)
    expect(host.textContent).toContain('日付・品目名・数量 の列を指定してください')

    await mapField('日付', 0)
    await mapField('品目名', 1)
    await mapField('数量', 2)
    expect(button('この指定で取り込む').disabled).toBe(false)

    button('この指定で取り込む').click()
    await nextTick()
    // 1行目のデータも残る
    expect(applied[0].csvText.split('\n')).toHaveLength(3)
    expect(applied[0].csvText).toContain('トマト')
    expect(applied[0].csvText).toContain('レタス')
  })
})
