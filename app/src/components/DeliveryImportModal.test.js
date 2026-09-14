/**
 * IMPORT-001 — 納品取込モーダルのコンポーネントテスト。
 *
 * parser が不正値を弾いても、画面が件数だけを出していれば
 * ユーザーは「何行がなぜ落ちたか」を知らないまま確定できてしまう。
 * ここでは**画面が行番号・列名・元の値・理由を出し、確認するまで取り込めない**ことを見る。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./DeliveryImportModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { imported: [], close: [] }
  app = createApp({
    render: () => h(Modal, {
      filename: '納品.csv',
      ctx: { order: ['玉ねぎ'], dictionary: {}, masterDict: {}, categories: {} },
      existingMovements: [],
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

function importButton() {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes('件を取り込む'))
}
async function ack() {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.includes('取り込まずに進む'))
  const input = label.querySelector('input')
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

const HEAD = '日付,品目名,数量,単位,単価'

describe('読めない値を黙って通さない', () => {
  it('行番号・列名・元の値・理由を出す', async () => {
    const { text } = await mount({
      csvText: `${HEAD}\n2026-06-01,玉ねぎ,20,kg,190\n2026-06-01,レタス,12abc,玉,100`,
    })
    expect(text()).toContain('3行目')
    expect(text()).toContain('数量')
    expect(text()).toContain('12abc')
    expect(text()).toContain('数値として読めません')
  })

  it('負の単価を null にすり替えず、行ごとエラーとして出す', async () => {
    const { text } = await mount({
      csvText: `${HEAD}\n2026-06-01,玉ねぎ,20,kg,190\n2026-06-01,レタス,10,玉,-100`,
    })
    expect(text()).toContain('-100')
    expect(text()).toContain('単価')
  })

  it('確認するまで取り込めない', async () => {
    const { events } = await mount({
      csvText: `${HEAD}\n2026-06-01,玉ねぎ,20,kg,190\n2026-06-01,レタス,12abc,玉,100`,
    })
    const btn = importButton()
    expect(btn.disabled).toBe(true)
    btn.click(); await nextTick()
    expect(events.imported).toHaveLength(0)

    await ack()
    expect(importButton().disabled).toBe(false)
  })

  it('不正行が無ければ確認は出ず、そのまま取り込める', async () => {
    const { text } = await mount({ csvText: `${HEAD}\n2026-06-01,玉ねぎ,20,kg,190` })
    expect(text()).not.toContain('取り込めない値が')
    expect(importButton().disabled).toBe(false)
  })

  // 種別列の出庫は、確認画面で数えたまま出庫として記録する（黙って捨てない）
  it('種別が出庫の行は出庫レコードとして取り込む', async () => {
    const { events, text } = await mount({
      csvText: [
        '日付,種別,品目名,数量,単位',
        '2026-06-01,入庫,玉ねぎ,20,kg',
        '2026-06-02,出庫,玉ねぎ,3,kg',
      ].join('\n'),
    })
    expect(text()).toContain('出庫')
    expect(text()).toContain('2件を取り込む')

    importButton().click()
    await nextTick()
    expect(events.imported[0].movements.map(m => m.type)).toEqual(['in', 'out'])
    expect(events.imported[0].movements[1]).toMatchObject({ date: '2026-06-02', source: 'import' })
  })

  it('正しい 1,200 と小数は受理する', async () => {
    const { events } = await mount({
      csvText: `${HEAD}\n2026-06-01,玉ねぎ,"1,200",kg,"1,500"\n2026-06-02,玉ねぎ,0.5,kg,80`,
    })
    importButton().click()
    await nextTick()
    // 日付ごとにまとめられるので movement は2件、明細の数量が桁区切りのまま入る
    expect(events.imported[0].movements).toHaveLength(2)
    expect(events.imported[0].movements[0].lines[0].qty).toBe(1200)
    expect(events.imported[0].movements[1].lines[0].qty).toBe(0.5)
  })
})
