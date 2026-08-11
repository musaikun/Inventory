/**
 * IMPORT-001 — 取込確認モーダルのコンポーネントテスト。
 *
 * 純関数側（itemImport.js）が正しく計画を組めても、画面がそれを出さなければ
 * 「黙って取り込んだ」ことに変わりない。ここでは画面に何が出るか、
 * どの条件で取り込めないか、閉じる操作が config を変えないかを見る。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./ItemImportPreviewModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { imported: [], close: [] }
  app = createApp({
    render: () => h(Modal, {
      ...props,
      onImported: (r) => events.imported.push(r),
      onClose:    ()  => events.close.push(true),
    }),
  })
  app.mount(host)
  await nextTick()
  return { events, text: () => host.textContent }
}

function click(selector) {
  const el = [...host.querySelectorAll('button')].find(b => b.textContent.includes(selector))
  if (!el) throw new Error(`button not found: ${selector} / had: ${[...host.querySelectorAll('button')].map(b => b.textContent.trim())}`)
  el.click()
  return nextTick()
}

async function pickRadio(labelText) {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const input = label.querySelector('input')
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

const HEAD = '品目名,単位,単価,カテゴリ,エイリアス'

let cfg
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
})

describe('件数と明細の表示', () => {
  it('追加・更新・変更なし・除外・エラーの件数を出す', async () => {
    const { text } = await mount({ csvText: `${HEAD}\nトマト,箱,120,野菜,\nレタス,玉,あ,野菜,\n,個,,,` })
    expect(text()).toContain('追加')
    expect(text()).toContain('更新')
    expect(text()).toContain('変更なし')
    expect(text()).toContain('除外')
    expect(text()).toContain('エラー')
  })

  it('取り込めない行を行番号・列・理由つきで出す', async () => {
    const { text } = await mount({ csvText: `${HEAD}\nトマト,箱,120,野菜,\nレタス,玉,あ,野菜,` })
    expect(text()).toContain('3行目')
    expect(text()).toContain('単価')
    expect(text()).toContain('数値として読めません')
  })

  it('1行も取り込めないファイルでも、行番号つきの理由を出す', async () => {
    const { text } = await mount({ csvText: `${HEAD}\nトマト,箱,あ,野菜,` })
    expect(text()).toContain('有効な品目が見つかりませんでした')
    expect(text()).toContain('2行目')
    expect(text()).toContain('数値として読めません')
  })

  it('ヘッダ無しファイルでは列指定を案内する', async () => {
    const { text } = await mount({ csvText: 'トマト,箱\nレタス,玉' })
    expect(text()).toContain('列を指定して取り込んでください')
    expect(text()).toContain('列指定でインポート')
  })

  it('分類コード・軸名・名称切り詰めをプレビューへ出す', async () => {
    const csv = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,保管場所,仕入先\n'
      + `${'あ'.repeat(210)},箱,120,野菜,,,7,,,冷蔵,青果A`
    const { text } = await mount({ csvText: csv })
    expect(text()).toContain('分類コードの変更')
    expect(text()).toContain('並び替え軸の名前をファイルから設定します')
    expect(text()).toContain('保管場所')
    expect(text()).toContain('切り詰めます')
  })

  it('発注点列の有無で、保持・解除の説明を実装と一致させる', async () => {
    const noCol = await mount({ csvText: `${HEAD}\nトマト,箱,120,野菜,` })
    expect(noCol.text()).toContain('今の発注点はそのまま残ります')
    app.unmount(); host.remove()

    const head = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点'
    const withCol = await mount({ csvText: `${head}\nトマト,箱,120,野菜,,,,,,,,` })
    expect(withCol.text()).toContain('空欄の行は発注点を解除します')
  })
})

describe('エイリアス衝突', () => {
  beforeEach(() => {
    cfg.loadFromCSV(`${HEAD}\nトマト,箱,120,野菜,"あかいやつ"\nレタス,玉,100,野菜,`)
  })

  it('衝突を表示し、解決を選ぶまで取り込めない', async () => {
    const { text } = await mount({ csvText: `${HEAD}\nレタス,玉,100,野菜,"あかいやつ"` })
    expect(text()).toContain('エイリアスが1件ぶつかっています')
    expect(text()).toContain('トマト → レタス')

    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('取り込む'))
    expect(btn.disabled).toBe(true)
    expect(text()).toContain('エイリアスの扱いを選ぶと取り込めます')
  })

  it('「今のままにする」を選ぶと既存品目のエイリアスを守る', async () => {
    const { events } = await mount({ csvText: `${HEAD}\nレタス,玉,100,野菜,"あかいやつ"` })
    await pickRadio('今のままにする')
    await click('取り込む')
    expect(events.imported).toHaveLength(1)
    expect(cfg.config.dictionary['あかいやつ']).toBe('トマト')
  })

  it('「ファイルの指定を優先する」を選んだときだけ付け替える', async () => {
    const { events } = await mount({ csvText: `${HEAD}\nレタス,玉,100,野菜,"あかいやつ"` })
    await pickRadio('ファイルの指定を優先する')
    await click('取り込む')
    expect(events.imported).toHaveLength(1)
    expect(cfg.config.dictionary['あかいやつ']).toBe('レタス')
  })
})

describe('取込方法の切り替え', () => {
  beforeEach(() => { cfg.loadFromCSV(`${HEAD}\n既存A,箱,120,野菜,\n既存B,玉,100,野菜,`) })

  it('既定は追加・更新で、既存品目を消さない', async () => {
    const { events } = await mount({ csvText: `${HEAD}\n新規,個,50,野菜,` })
    await click('取り込む')
    expect(events.imported[0].mode).toBe('merge')
    expect(cfg.config.order).toEqual(['既存A', '既存B', '新規'])
  })

  it('全入れ替えは削除対象を出し、確認チェックを通すまで実行できない', async () => {
    const { text } = await mount({ csvText: `${HEAD}\n新規,個,50,野菜,` })
    await pickRadio('全入れ替え')
    expect(text()).toContain('2件の品目が削除されます')
    expect(text()).toContain('既存A')

    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('全入れ替えする'))
    expect(btn.disabled).toBe(true)
    expect(cfg.config.order).toEqual(['既存A', '既存B'])   // まだ何も変えていない
  })

  it('全入れ替えの説明が undo の実態（直後1回・端末メモリのみ）と一致する', async () => {
    const { text } = await mount({ csvText: `${HEAD}\n新規,個,50,野菜,` })
    await pickRadio('全入れ替え')
    expect(text()).toContain('1回だけ戻せます')
    expect(text()).not.toContain('この操作は取り消せません')
  })
})

describe('閉じる操作', () => {
  it('キャンセルは close を1回だけ出し、config を変更しない', async () => {
    cfg.loadFromCSV(`${HEAD}\n既存,箱,120,野菜,`)
    const before = [...cfg.config.order]
    const { events } = await mount({ csvText: `${HEAD}\n新規,個,50,野菜,` })

    await click('キャンセル')
    await click('キャンセル')   // 二度押しても増えない
    expect(events.close).toHaveLength(1)
    expect(cfg.config.order).toEqual(before)
  })

  it('Escape とオーバーレイクリックが重なっても close は1回だけ', async () => {
    const { events } = await mount({ csvText: `${HEAD}\n新規,個,50,野菜,` })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    host.querySelector('.modal-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(events.close).toHaveLength(1)
  })
})

describe('プレビューと取込の一致', () => {
  it('プレビューに出した計画をそのまま適用する（取込結果が件数と一致する）', async () => {
    cfg.loadFromCSV(`${HEAD}\nトマト,箱,120,野菜,`)
    const { events, text } = await mount({ csvText: `${HEAD}\nトマト,ケース,150,野菜,\n新規,個,50,野菜,` })
    expect(text()).toContain('取込後の登録品目は')

    await click('取り込む')
    const r = events.imported[0]
    expect(r.added).toBe(1)
    expect(r.updated).toBe(1)
    expect(cfg.config.units['トマト']).toBe('ケース')
    expect(cfg.config.prices['トマト']).toBe(150)
  })
})
