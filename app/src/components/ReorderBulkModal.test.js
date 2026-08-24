// 発注点の一括設定（D4）の回帰。
// 部分利用のユーザーはここが推奨発注数の土台になるので、
// 「まとめて入れられる」ことと「推測で埋めない」ことの両方を守る。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(rows) {
  const { default: Modal } = await import('./ReorderBulkModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const updates = []
  app = createApp({
    render: () => h(Modal, {
      rows,
      unitOf: () => '個',
      onUpdate: (item, v) => updates.push([item, v]),
      onClose: () => {},
    }),
  })
  app.mount(host)
  await nextTick()
  return updates
}

const row = (item, current, suggested, basis = '') => ({ item, current, suggested, basis, source: suggested ? 'consumption' : null })
function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('ReorderBulkModal', () => {
  it('既定では未設定の品目だけを出す', async () => {
    await mount([row('トマト', null, 5), row('レタス', 3, 4)])
    expect(host.textContent).toContain('トマト')
    expect(host.textContent).not.toContain('レタス')
    expect(host.textContent).toContain('未設定のみ（1件）')
  })

  it('チェックを外すと全品目を出す', async () => {
    await mount([row('トマト', null, 5), row('レタス', 3, 4)])
    const cb = host.querySelector('input[type="checkbox"]')
    cb.checked = false
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(host.textContent).toContain('レタス')
  })

  it('目安をタップすると、その品目に反映する', async () => {
    const updates = await mount([row('トマト', null, 5, '推定消費 1.0/日 × 5日')])
    button('目安 5').click()
    await nextTick()
    expect(updates).toEqual([['トマト', 5]])
  })

  it('まとめて採用は、未設定かつ目安がある品目だけを埋める', async () => {
    const updates = await mount([
      row('トマト', null, 5),
      row('レタス', 3, 4),        // すでに設定済み → 上書きしない
      row('きゅうり', null, null), // 目安が無い → 埋めない
    ])
    button('提案をまとめて採用（1件）').click()
    await nextTick()
    expect(updates).toEqual([['トマト', 5]])
  })

  it('目安が無い品目は理由を出し、空欄のままにする（推測で埋めない）', async () => {
    await mount([row('きゅうり', null, null)])
    expect(host.textContent).toContain('目安を出せません')
    expect(button('提案をまとめて採用（0件）').disabled).toBe(true)
    expect(host.querySelector('.rb-input').value).toBe('')
  })

  it('手入力もそのまま渡す', async () => {
    const updates = await mount([row('トマト', null, 5)])
    const input = host.querySelector('.rb-input')
    input.value = '8'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(updates).toEqual([['トマト', '8']])
  })
})
