/**
 * IMPORT-001 — 列指定インポートの画面間の受け渡し（配線）テスト。
 *
 * CsvMapperModal と ItemImportPreviewModal がそれぞれ正しくても、
 * 画面をつなぐ SettingsModal が `hasHeader` を落とせば、
 * 「1行目からデータ」を選んだのに1行目の品目が消える。
 * ここは**実際の画面を通して**ヘッダ無しCSVを取り込み、config に何が入ったかを見る。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mountSettings() {
  const { default: Settings } = await import('./SettingsModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Settings, { section: 'import', onClose: () => {} }),
  })
  app.mount(host)
  await nextTick()
}

let cfg
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
})

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}
function radioInput(labelText) {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  return label.querySelector('input')
}
async function pick(labelText) {
  const input = radioInput(labelText)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

/**
 * マッピング画面で列を選ぶ。見出しが無いファイルでは列名から自動検出できないので、
 * 実際のユーザーと同じく select を操作して対応づける。
 */
async function mapField(fieldLabel, colIndex) {
  const row = [...host.querySelectorAll('.mapping-row')]
    .find(r => r.querySelector('.mapping-field-name')?.textContent.trim() === fieldLabel)
  if (!row) throw new Error(`mapping row not found: ${fieldLabel}`)
  const select = row.querySelector('select')
  select.value = String(colIndex)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

/** ファイル選択の代わりに、実際の openMapper と同じ入口へ CSV を流し込む */
async function openMapperWith(csvText, filename = 'items.csv') {
  // 列指定インポート用の input（accept に text/csv を含む2番目のもの）
  const input = [...host.querySelectorAll('input[type="file"]')]
    .find(i => i.accept.includes('text/csv'))
  const file = new File([csvText], filename, { type: 'text/csv' })
  // jsdom の File.text() は環境によって未実装なので、必要な API だけ差し替える
  if (typeof file.text !== 'function') file.text = async () => csvText
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  // ファイル読み込み（await）を挟むので、マイクロタスクを数回流す
  for (let i = 0; i < 6; i++) await nextTick()
}

describe('ヘッダ無しCSVを実UI経由で取り込む', () => {
  it('「1行目からデータ」を選ぶと1行目の品目が残る', async () => {
    await mountSettings()
    await openMapperWith('トマト,箱,120\nレタス,玉,80')

    // マッピング画面が開き、見出しの無いファイルなので「1行目からデータ」が既定
    expect(radioInput('1行目からデータ').checked).toBe(true)
    await mapField('単位', 1)
    await mapField('単価', 2)
    button('このマッピングでインポート').click()
    for (let i = 0; i < 4; i++) await nextTick()

    // 確認画面へ hasHeader が渡っている
    expect(host.textContent).toContain('1行目からデータ')
    button('取り込む').click()
    for (let i = 0; i < 4; i++) await nextTick()

    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.prices['トマト']).toBe(120)
    expect(cfg.config.units['トマト']).toBe('箱')
  })

  it('「1行目は見出し」へ切り替えると1行目は列名として扱われる', async () => {
    await mountSettings()
    await openMapperWith('トマト,箱,120\nレタス,玉,80')

    await pick('1行目は見出し')
    button('このマッピングでインポート').click()
    for (let i = 0; i < 4; i++) await nextTick()

    expect(host.textContent).toContain('1行目は見出し')
    button('取り込む').click()
    for (let i = 0; i < 4; i++) await nextTick()

    expect(cfg.config.order).toEqual(['レタス'])
  })

  it('引用符・カンマ・改行を含むセルが画面を通しても壊れない', async () => {
    await mountSettings()
    await openMapperWith('"5"" 皿",箱,120\r\n"トマト,大玉",ケース,300\r\n')

    expect(radioInput('1行目からデータ').checked).toBe(true)
    await mapField('単価', 2)
    button('このマッピングでインポート').click()
    for (let i = 0; i < 4; i++) await nextTick()
    button('取り込む').click()
    for (let i = 0; i < 4; i++) await nextTick()

    expect(cfg.config.order).toEqual(['5" 皿', 'トマト,大玉'])
    expect(cfg.config.prices['トマト,大玉']).toBe(300)
  })
})
