/**
 * IMPORT-001 — 過去棚卸取込モーダルのコンポーネントテスト。
 *
 * 純関数側（pastImportPlan.js）が再試行と取消を持っていても、画面がその導線を出さなければ
 * ユーザーは何もできない。ここでは**画面が何を出し、何を押せるか**だけを見る。
 *   ・応答喪失のあとも計画と取込IDが残り、再試行と取消の両方を押せる
 *   ・再試行では失敗・結果不明の日だけを、同じ取込IDで送り直す
 *   ・savedCount=0 でも結果不明があれば取消できる
 *   ・保存中は二重押しできない
 *   ・読めない行は行番号つきで出し、確認するまで取り込めない
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { buildPastImportPlan, OUTCOME_FAILED, OUTCOME_UNKNOWN } from '../services/pastImportPlan.js'

let app = null
let host = null

const PLAN_DAYS = [
  { date: '2026-05-01', items: [{ item: '米', qty: 1 }] },
  { date: '2026-05-08', items: [{ item: '米', qty: 2 }] },
  { date: '2026-05-15', items: [{ item: '米', qty: 3 }] },
]

async function mount({ plan, confirmImport, undoImport } = {}) {
  const { default: Modal } = await import('./PastStocktakeImportModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { imported: [], close: [], resolve: [] }
  app = createApp({
    render: () => h(Modal, {
      plan:          plan ?? buildPastImportPlan(PLAN_DAYS, { importBatchId: 'imp_test' }),
      filename:      '過去棚卸.csv',
      confirmImport: confirmImport ?? (() => ({ importBatchId: 'imp_test', saved: [], failed: [], ok: false })),
      undoImport:    undoImport    ?? (() => ({ ok: true, removedOnServer: 0, removedLocally: 0 })),
      onImported: (r) => events.imported.push(r),
      onClose:    ()  => events.close.push(true),
      onResolve:  (r) => events.resolve.push(r),
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

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}
async function click(label) {
  const btn = button(label)
  if (!btn) throw new Error(`button not found: ${label} / had: ${[...host.querySelectorAll('button')].map(b => b.textContent.trim())}`)
  btn.click()
  await nextTick(); await nextTick()
  return btn
}
async function check(labelText) {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const input = label.querySelector('input')
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

/**
 * 3日ぶんのうち、指定した日だけ「結果不明」を返す confirm。
 * `recoverAfter` 回目の呼び出し以降は全日成功する（＝再試行で回復する状況）。
 */
function partialConfirm(unknownDates, { recoverAfter = 1 } = {}) {
  let calls = 0
  return vi.fn(async (onlyDates) => {
    const recovered = calls++ >= recoverAfter
    const dates = onlyDates ?? PLAN_DAYS.map(d => d.date)
    const saved = [], failed = []
    for (const date of dates) {
      if (!recovered && unknownDates.includes(date)) {
        failed.push({ date, error: '応答がありません', outcome: OUTCOME_UNKNOWN, retryable: true })
      } else {
        saved.push({ date, sessionId: `s-${date}` })
      }
    }
    return { importBatchId: 'imp_test', saved, failed, ok: failed.length === 0 }
  })
}

describe('応答喪失のあとも計画と取込IDを保持する', () => {
  it('取込IDを画面に出し、再試行と取消の両方を押せる', async () => {
    const { text } = await mount({ confirmImport: partialConfirm(['2026-05-08', '2026-05-15'], { recoverAfter: Infinity }) })
    await click('取り込む')

    expect(text()).toContain('imp_test')
    expect(text()).toContain('結果不明')
    expect(button('同じ取込IDで再試行')).toBeTruthy()
    expect(button('この取込を取り消す')).toBeTruthy()
  })

  it('1日も保存できていなくても、結果不明があれば取消を出す', async () => {
    const { text } = await mount({ confirmImport: partialConfirm(PLAN_DAYS.map(d => d.date), { recoverAfter: Infinity }) })
    await click('取り込む')

    expect(text()).toContain('取り込めませんでした')
    expect(button('この取込を取り消す')).toBeTruthy()
  })

  it('confirmImport 自体が例外を投げても取込IDと導線が残る', async () => {
    const { text } = await mount({ confirmImport: () => { throw new Error('Failed to fetch') } })
    await click('取り込む')

    expect(text()).toContain('imp_test')
    expect(text()).toContain('結果不明')
    expect(button('同じ取込IDで再試行')).toBeTruthy()
    expect(button('この取込を取り消す')).toBeTruthy()
  })
})

describe('再試行', () => {
  it('失敗・結果不明の日だけを、同じ取込IDで送り直す', async () => {
    const confirmImport = partialConfirm(['2026-05-08', '2026-05-15'])
    const { text } = await mount({ confirmImport })
    await click('取り込む')
    expect(confirmImport.mock.calls[0][0]).toBeUndefined()   // 初回は全日

    await click('同じ取込IDで再試行')
    expect(confirmImport.mock.calls[1][0]).toEqual(['2026-05-08', '2026-05-15'])
    expect(text()).toContain('3日分をサーバーに保存しました')
  })

  it('成功済みの日を再送しないので、件数が二重にならない', async () => {
    const confirmImport = partialConfirm(['2026-05-15'])
    const { text, events } = await mount({ confirmImport })
    await click('取り込む')
    expect(text()).toContain('2日分を保存しました')

    await click('同じ取込IDで再試行')
    expect(text()).toContain('3日分をサーバーに保存しました')
    expect(text()).not.toContain('4日分')
    // 端末へ反映した日も重複しない
    const lastSaved = events.imported.at(-1).saved.map(s => s.date)
    expect(new Set(lastSaved).size).toBe(lastSaved.length)
  })

  it('すべて成功したら再試行ボタンを出さない', async () => {
    const { text } = await mount({ confirmImport: partialConfirm([]) })
    await click('取り込む')
    expect(button('同じ取込IDで再試行')).toBeUndefined()
    expect(text()).toContain('3日分をサーバーに保存しました')
  })
})

describe('二重押しの防止', () => {
  it('保存中は取り込むボタンを無効にし、confirmImport を1回しか呼ばない', async () => {
    let resolveFn
    const confirmImport = vi.fn(() => new Promise(r => { resolveFn = r }))
    await mount({ confirmImport })

    const btn = button('取り込む')
    btn.click(); await nextTick()
    btn.click(); btn.click(); await nextTick()
    expect(confirmImport).toHaveBeenCalledTimes(1)
    expect(button('保存中…').disabled).toBe(true)

    resolveFn({ importBatchId: 'imp_test', saved: [{ date: '2026-05-01' }], failed: [], ok: true })
    await nextTick(); await nextTick()
  })

  it('取り消し中は取消ボタンを無効にし、undoImport を1回しか呼ばない', async () => {
    let resolveFn
    const undoImport = vi.fn(() => new Promise(r => { resolveFn = r }))
    await mount({ confirmImport: partialConfirm([]), undoImport })
    await click('取り込む')

    const btn = button('この取込を取り消す')
    btn.click(); await nextTick()
    btn.click(); await nextTick()
    expect(undoImport).toHaveBeenCalledTimes(1)

    resolveFn({ ok: true, removedOnServer: 3, removedLocally: 3 })
    await nextTick(); await nextTick()
    expect(host.textContent).toContain('取り消しました')
  })

  it('保存中・取消中は閉じられない（結果を見失わない）', async () => {
    let resolveFn
    const confirmImport = vi.fn(() => new Promise(r => { resolveFn = r }))
    const { events } = await mount({ confirmImport })
    button('取り込む').click()
    await nextTick()

    button('キャンセル').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(events.close).toHaveLength(0)

    resolveFn({ importBatchId: 'imp_test', saved: [], failed: [], ok: false })
    await nextTick(); await nextTick()
  })
})

describe('取消の失敗を黙って成功にしない', () => {
  it('取消に失敗したら理由と取込IDを残す', async () => {
    const undoImport = vi.fn(() => { throw new Error('サーバーが応答しません') })
    const { text } = await mount({ confirmImport: partialConfirm([]), undoImport })
    await click('取り込む')
    await click('この取込を取り消す')

    expect(text()).toContain('サーバーが応答しません')
    expect(text()).toContain('imp_test')
    expect(button('この取込を取り消す')).toBeTruthy()   // もう一度押せる
  })
})

describe('読めなかった行の扱い', () => {
  const planWithErrors = () => ({
    ...buildPastImportPlan(PLAN_DAYS, { importBatchId: 'imp_test' }),
    rowErrors: [
      { line: 4, columnLabel: '数量', value: '12abc', name: 'ビール', reason: '数量「12abc」は数値として読めません' },
    ],
  })

  it('行番号・列名・元の値・理由を出す', async () => {
    const { text } = await mount({ plan: planWithErrors() })
    expect(text()).toContain('4行目')
    expect(text()).toContain('数量')
    expect(text()).toContain('12abc')
    expect(text()).toContain('数値として読めません')
  })

  it('確認するまで取り込めない（気づかないまま確定できない）', async () => {
    const confirmImport = vi.fn(() => ({ importBatchId: 'imp_test', saved: [], failed: [], ok: false }))
    await mount({ plan: planWithErrors(), confirmImport })

    expect(button('取り込む').disabled).toBe(true)
    button('取り込む').click()
    await nextTick()
    expect(confirmImport).not.toHaveBeenCalled()

    await check('取り込まずに進む')
    expect(button('取り込む').disabled).toBe(false)
  })
})

describe('取消できる範囲の説明が実挙動と一致する', () => {
  it('取込前から「この取込ぶんだけ取り消せる」と説明する', async () => {
    const { text } = await mount({})
    expect(text()).toContain('この取込ぶんだけ')
    expect(text()).not.toContain('取り消しできません')
  })
})

describe('結果不明が残っているあいだは閉じられない', () => {
  const allUnknown  = () => partialConfirm(PLAN_DAYS.map(d => d.date), { recoverAfter: Infinity })
  const someUnknown = () => partialConfirm(['2026-05-08', '2026-05-15'], { recoverAfter: Infinity })

  /** 閉じる3経路（ボタン・Escape・オーバーレイ）をすべて試す */
  async function tryCloseEveryWay() {
    const btn = button('閉じる') ?? button('キャンセル')
    btn.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    host.querySelector('.modal-overlay').dispatchEvent(new MouseEvent('click', { bubbles: false }))
    await nextTick(); await nextTick()
    return btn
  }

  it('全件が結果不明なら、閉じるボタン・Escape・オーバーレイのすべてで閉じない', async () => {
    const { events, text } = await mount({ confirmImport: allUnknown() })
    await click('取り込む')

    const btn = await tryCloseEveryWay()
    expect(events.close).toHaveLength(0)
    expect(btn.disabled).toBe(true)
    expect(text()).toContain('結果不明が残っている')
  })

  it('一部成功＋一部結果不明でも閉じない', async () => {
    const { events, text } = await mount({ confirmImport: someUnknown() })
    await click('取り込む')

    await tryCloseEveryWay()
    expect(events.close).toHaveLength(0)
    expect(text()).toContain('結果不明が残っている')
  })

  it('閉じようとしても取込IDと計画を保持する', async () => {
    const confirmImport = someUnknown()
    const { text } = await mount({ confirmImport })
    await click('取り込む')

    await tryCloseEveryWay()
    expect(text()).toContain('imp_test')

    // 同じ batchId のまま再試行でき、送る日も変わらない
    await click('同じ取込IDで再試行')
    expect(confirmImport.mock.calls[1][0]).toEqual(['2026-05-08', '2026-05-15'])
  })

  it('閉じられないあいだも再試行と取消の両方を押せる', async () => {
    await mount({ confirmImport: allUnknown() })
    await click('取り込む')
    await tryCloseEveryWay()

    expect(button('同じ取込IDで再試行')).toBeTruthy()
    expect(button('同じ取込IDで再試行').disabled).toBe(false)
    expect(button('この取込を取り消す')).toBeTruthy()
    expect(button('この取込を取り消す').disabled).toBe(false)
  })

  it('再試行しても結果不明が残るなら、まだ閉じられない', async () => {
    const { events } = await mount({ confirmImport: allUnknown() })
    await click('取り込む')
    await click('同じ取込IDで再試行')

    await tryCloseEveryWay()
    expect(events.close).toHaveLength(0)
  })

  it('再試行で全日が確定したら閉じられる（close は1回だけ）', async () => {
    // 1回目は結果不明、再試行で回復する
    const { events } = await mount({ confirmImport: partialConfirm(PLAN_DAYS.map(d => d.date)) })
    await click('取り込む')
    await tryCloseEveryWay()
    expect(events.close).toHaveLength(0)

    await click('同じ取込IDで再試行')
    await tryCloseEveryWay()
    expect(events.close).toHaveLength(1)
  })

  it('取消に成功したら閉じられる（close は1回だけ）', async () => {
    const { events } = await mount({
      confirmImport: allUnknown(),
      undoImport: async () => ({ ok: true, removedOnServer: 3, removedLocally: 0 }),
    })
    await click('取り込む')
    await tryCloseEveryWay()
    expect(events.close).toHaveLength(0)

    await click('この取込を取り消す')
    await tryCloseEveryWay()
    expect(events.close).toHaveLength(1)
  })

  it('取消に失敗したら引き続き閉じられない', async () => {
    const { events, text } = await mount({
      confirmImport: allUnknown(),
      undoImport: () => { throw new Error('サーバーが応答しません') },
    })
    await click('取り込む')
    await click('この取込を取り消す')

    await tryCloseEveryWay()
    expect(events.close).toHaveLength(0)
    expect(text()).toContain('サーバーが応答しません')
    expect(button('この取込を取り消す')).toBeTruthy()   // もう一度押せる
  })

  it('明確なHTTP失敗だけで結果不明が無ければ閉じられる', async () => {
    const confirmImport = vi.fn(async () => ({
      importBatchId: 'imp_test',
      saved: [],
      failed: PLAN_DAYS.map(d => ({
        date: d.date, error: '品目数が多すぎます', outcome: OUTCOME_FAILED, retryable: false,
      })),
      ok: false,
    }))
    const { events, text } = await mount({ confirmImport })
    await click('取り込む')

    expect(text()).toContain('保存されず')
    expect(text()).not.toContain('結果不明が残っている')
    await tryCloseEveryWay()
    expect(events.close).toHaveLength(1)
  })

  it('永続的な失敗では再試行・取消を出さない', async () => {
    const confirmImport = vi.fn(async () => ({
      importBatchId: 'imp_test',
      saved: [],
      failed: [{ date: '2026-05-01', error: '不正な日付です', outcome: OUTCOME_FAILED, retryable: false }],
      ok: false,
    }))
    await mount({ confirmImport })
    await click('取り込む')

    expect(button('同じ取込IDで再試行')).toBeUndefined()
    expect(button('この取込を取り消す')).toBeUndefined()
  })

  it('再試行できるHTTP失敗（503）では再試行を出す', async () => {
    const confirmImport = vi.fn(async () => ({
      importBatchId: 'imp_test',
      saved: [],
      failed: [{ date: '2026-05-01', error: '混雑しています', outcome: OUTCOME_FAILED, retryable: true }],
      ok: false,
    }))
    await mount({ confirmImport })
    await click('取り込む')

    expect(button('同じ取込IDで再試行')).toBeTruthy()
  })
})
