/**
 * IMPORT-001 — 列指定マッピング画面のコンポーネントテスト。
 *
 * ここが確かめるのは「純関数が正しい」ことではなく、**画面がその契約どおりに動く**ことだけ。
 *   ・1行目を見出しにするかデータにするかを選べる
 *   ・「1行目からデータ」を選んだら 1行目の品目が消えない
 *   ・選択が次の画面（確認 → 確定）へ hasHeader として渡る
 *   ・字句解析が共通トークナイザ（引用符つきカンマ・エスケープ引用符・改行）になっている
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./CsvMapperModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { imported: [], close: [] }
  app = createApp({
    render: () => h(Modal, {
      axisNames: ['', ''],
      ...props,
      onImported: (p) => events.imported.push(p),
      onClose:    ()  => events.close.push(true),
    }),
  })
  app.mount(host)
  await nextTick()
  return { events, text: () => host.textContent }
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
})

function radio(labelText) {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  return label.querySelector('input')
}

async function pick(labelText) {
  const input = radio(labelText)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

async function clickImport() {
  const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('このマッピングでインポート'))
  btn.click()
  await nextTick()
  return btn
}

const HEADED    = '品目名,単位,単価\nトマト,箱,120\nレタス,玉,80'
const HEADERLESS = 'トマト,箱,120\nレタス,玉,80'

describe('1行目の扱いを明示的に選ばせる', () => {
  it('見出しらしい1行目なら「1行目は見出し」を既定にする', async () => {
    await mount({ csvText: HEADED })
    expect(radio('1行目は見出し').checked).toBe(true)
    expect(radio('1行目からデータ').checked).toBe(false)
  })

  it('見出しの無いファイルは「1行目からデータ」を既定にする', async () => {
    await mount({ csvText: HEADERLESS })
    expect(radio('1行目からデータ').checked).toBe(true)
  })

  it('「1行目からデータ」では1行目もプレビューに出て、データ行数に数える', async () => {
    const { text } = await mount({ csvText: HEADERLESS })
    expect(text()).toContain('データ2行')
    expect(text()).toContain('トマト')     // 1行目が消えない
    expect(text()).toContain('レタス')
  })

  it('「1行目は見出し」では1行目が列名になり、データ行数から外れる', async () => {
    const { text } = await mount({ csvText: HEADED })
    expect(text()).toContain('データ2行')
    // 見出しの語が列選択肢に出る
    expect([...host.querySelectorAll('option')].some(o => o.textContent.includes('品目名'))).toBe(true)
  })

  it('選択を切り替えると列見出しの表示が 列1… に変わる', async () => {
    const { text } = await mount({ csvText: HEADED })
    await pick('1行目からデータ')
    expect(text()).toContain('列1')
    expect(text()).toContain('データ3行')   // 見出しだった行もデータになる
  })
})

describe('確定処理まで hasHeader を運ぶ', () => {
  it('「1行目からデータ」の選択を imported ペイロードへ載せる', async () => {
    const { events } = await mount({ csvText: HEADERLESS })
    await clickImport()
    expect(events.imported).toHaveLength(1)
    expect(events.imported[0].hasHeader).toBe(false)
    expect(events.imported[0].csvText).toBe(HEADERLESS)
    expect(events.imported[0].mapping.name).toBe(0)
  })

  it('「1行目は見出し」の選択も同じ経路で渡す', async () => {
    const { events } = await mount({ csvText: HEADED })
    await clickImport()
    expect(events.imported[0].hasHeader).toBe(true)
  })
})

describe('字句解析は共通トークナイザを使う', () => {
  it('引用符つきカンマでセルを割らない', async () => {
    const { text } = await mount({ csvText: '"トマト,大玉",箱,120' })
    expect(text()).toContain('トマト,大玉')
  })

  it('エスケープされた引用符を値の中の " として保つ', async () => {
    const { events } = await mount({ csvText: '"5"" 皿",箱,120' })
    await clickImport()
    // 画面が csvText をそのまま渡し、解析は共通経路で行う
    expect(events.imported[0].csvText).toContain('5""')
    expect(host.textContent).toContain('5" 皿')
  })

  it('引用符の中の改行でレコードを割らない', async () => {
    const { text } = await mount({ csvText: '"トマト\n大玉",箱,120\nレタス,玉,80' })
    expect(text()).toContain('データ2行')
  })

  it('閉じていない引用符は黙って受理せず、インポートさせない', async () => {
    const { text } = await mount({ csvText: '"トマト,箱,120\nレタス,玉,80' })
    expect(text()).toContain('引用符')
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('このマッピングでインポート'))
    expect(btn.disabled).toBe(true)
  })

  it('BOM と CRLF を同じ結果へ寄せる', async () => {
    const { text } = await mount({ csvText: '﻿トマト,箱,120\r\nレタス,玉,80\r\n' })
    expect(text()).toContain('データ2行')
    expect(text()).toContain('トマト')
  })
})
