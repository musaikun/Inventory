/**
 * 列指定インポートの画面間の受け渡し（配線）テスト。
 *
 * ImportMapper と ItemImportPreviewModal がそれぞれ正しくても、画面をつなぐ
 * SettingsModal が「表がどこから始まるか」を落とせば、選んだのに1行目の品目が消える。
 * ここは**実際の画面を通して**取り込み、config に何が入ったかを見る。
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
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await nextTick() }

/** いま出ている問い（無ければ空文字） */
function questionText() { return host.querySelector('.imp-q')?.textContent.trim() ?? '' }

/** 「見出しの行を選んでください」で、ファイルの ri 行目をタップする */
async function tapHeaderRow(ri) {
  const rows = [...host.querySelectorAll('.peek.headerRow .peek-row')]
  if (!rows[ri]) throw new Error(`header row ${ri} not found`)
  // 実機と同じくセルを押す。セルは行を覆っているので、ここで止まると行に届かない
  rows[ri].querySelectorAll('.peek-c')[0].click()
  await settle()
}
async function tapNoHeader() {
  [...host.querySelectorAll('button')].find(b => b.textContent.includes('見出しの行はありません')).click()
  await settle()
}
/** 「最初の品目名を選んでください」で (行, 列) のセルをタップする */
async function tapCell(ri, ci) {
  const row = [...host.querySelectorAll('.peek.firstItem .peek-row')][ri]
  if (!row) throw new Error(`row ${ri} not found`)
  row.querySelectorAll('.peek-c')[ci].click()
  await settle()
}
/** マッピング面で列をタップして項目を割り当てる */
async function mapColumn(ci, fieldLabel) {
  const headCells = [...host.querySelectorAll('.peek.mapped .peek-head .peek-c')]
  if (!headCells[ci]) throw new Error(`column ${ci} not found`)
  headCells[ci].click()
  await settle(2)
  const chip = [...host.querySelectorAll('.fbar .fchip')].find(b => b.textContent.trim().startsWith(fieldLabel))
  if (!chip) throw new Error(`field chip not found: ${fieldLabel}`)
  chip.click()
  await settle()
}
/** マッピング面の「取り込む」→ 確認画面の「取り込む」 */
async function finishImport() {
  host.querySelector('.imp-go').click()
  await settle()
  button('取り込む').click()
  await settle()
}

/** 通常の取込入口（ドロップゾーン）へCSVを流し込む。確認画面まで進む */
async function importWith(csvText, filename = 'items.csv') {
  const input = [...host.querySelectorAll('input[type="file"]')]
    .find(i => i.accept.includes('.pdf'))
  const file = new File([csvText], filename, { type: 'text/csv' })
  if (typeof file.text !== 'function') file.text = async () => csvText
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  // FileReader は非同期。読み終わるまでマクロタスクを待つ
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick() }
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

describe('列指定インポートを実UI経由で通す', () => {
  it('問いに答えるまで取り込みへ進めない', async () => {
    await mountSettings()
    await openMapperWith('トマト,箱,120\nレタス,玉,80')

    // 最初の問いは常に同じ。ファイルの形で画面が変わらない
    expect(questionText()).toContain('見出しの行を選んでください')
    expect(host.querySelector('.imp-go')).toBeNull()
    expect(cfg.config.order).toEqual([])
  })

  it('「見出しの行はありません」→ 最初の品目名を選ぶと1行目の品目が残る', async () => {
    await mountSettings()
    await openMapperWith('トマト,箱,120\nレタス,玉,80')

    await tapNoHeader()
    expect(questionText()).toContain('最初の品目名')
    await tapCell(0, 0)          // 1行目・1列目の「トマト」

    await mapColumn(1, '単位')
    await mapColumn(2, '単価')
    await finishImport()

    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.prices['トマト']).toBe(120)
    expect(cfg.config.units['トマト']).toBe('箱')
  })

  it('見出しの行を選ぶと、その行は列名として扱われる', async () => {
    await mountSettings()
    await openMapperWith('品名,単位,単価\nトマト,箱,120\nレタス,玉,80')

    await tapHeaderRow(0)
    await finishImport()

    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.prices['トマト']).toBe(120)   // 見出し名から自動で当たっている
  })

  it('表がファイルの途中から始まっても、前置きを取り込まない', async () => {
    await mountSettings()
    await openMapperWith('株式会社 東西酒販\n発行日 2026/08/01\n品名,単位,単価\nトマト,箱,120')

    // 空行が無いので、見出しは3行目（index 2）
    await tapHeaderRow(2)
    await finishImport()

    expect(cfg.config.order).toEqual(['トマト'])
  })

  it('見出しらしいファイルでも、選ぶまでは推測で確定しない', async () => {
    await mountSettings()
    await openMapperWith('品名,単位,単価\nトマト,箱,120')
    // 見当は出すが、選択値にはしない
    expect(questionText()).toContain('見出しの行を選んでください')
    expect(host.querySelector('.peek-row.guess')).not.toBeNull()
    expect(cfg.config.order).toEqual([])
  })

  it('外した行は確認画面から戻せる（本当に「小計」という品目のため）', async () => {
    await mountSettings()
    await openMapperWith('小計,箱,120\nトマト,箱,120')
    await tapNoHeader()
    await tapCell(0, 0)
    host.querySelector('.imp-go').click()
    await settle()

    const back = [...host.querySelectorAll('label')]
      .find(l => l.textContent.includes('これらも品目として取り込む'))?.querySelector('input')
    expect(back, '戻すチェックボックス').toBeTruthy()
    back.checked = true
    back.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    button('取り込む').click()
    await settle()
    expect(cfg.config.order).toEqual(['小計', 'トマト'])
  })

  it('引用符・カンマ・改行を含むセルが画面を通しても壊れない', async () => {
    await mountSettings()
    await openMapperWith('"5"" 皿",箱,120\r\n"トマト,大玉",ケース,300\r\n')

    await tapNoHeader()
    await tapCell(0, 0)
    await mapColumn(2, '単価')
    await finishImport()

    expect(cfg.config.order).toEqual(['5" 皿', 'トマト,大玉'])
    expect(cfg.config.prices['トマト,大玉']).toBe(300)
  })
})

// 推奨フォーマットに合わないファイルを行き止まりにしない（ユーザー報告）。
// 「形式を確認してください」で終わると、仕入先のCSVを取り込む手段が画面から消える。
describe('フォーマット不明のファイルから列指定インポートへ移れる', () => {
  it('確認画面のエラーから列指定へ進み、そのまま取り込める', async () => {
    await mountSettings()
    await importWith('トマト,箱,120\nレタス,玉,80')

    // 推奨フォーマットとして解析できず、確認画面がエラーを出している
    expect(host.textContent).toContain('列を指定して取り込んでください')

    button('列を指定して取り込む').click()
    await settle()

    // マッピング画面が同じ内容で開く（ファイルを選び直させない）
    expect(questionText()).toContain('見出しの行を選んでください')
    await tapNoHeader()
    await tapCell(0, 0)
    await mapColumn(1, '単位')
    await mapColumn(2, '単価')
    await finishImport()

    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.prices['トマト']).toBe(120)
  })

  it('列指定の結果が空でも、指定をやり直せる', async () => {
    await mountSettings()
    await openMapperWith('トマト,箱,\nレタス,玉,')
    await tapNoHeader()
    await tapCell(0, 2)          // 空の列を品目名に当てる＝有効な品目が1件も無い
    host.querySelector('.imp-go').click()
    await settle()

    const retry = button('列の指定をやり直す')
    expect(retry).not.toBeUndefined()
    retry.click()
    await settle()
    expect(questionText()).toContain('見出しの行を選んでください')
    expect(cfg.config.order).toEqual([])
  })
})

// レシピ（保存した読み方）。同じ帳票は毎月同じ形で来るので、2回目以降に
// 人が答えることは本来1つも無い。答えさせているうちは仕組みが仕事をしていない。
describe('読み方をレシピとして保存し、次回は問いを飛ばす', () => {
  const FILE = '商品ｺｰﾄﾞ,商品名,単位,仕入単価\n12687,サラダ用カップ,個,20\n12690,コーヒー豆,kg,1800'

  it('取り込んだ後に訊かれ、保存すると次のファイルで問いが出ない', async () => {
    await mountSettings()
    await openMapperWith(FILE, '仕入先マスタ_2026.csv')
    await tapHeaderRow(0)
    await finishImport()
    expect(cfg.config.order).toEqual(['サラダ用カップ', 'コーヒー豆'])

    // 合っていたと分かった後で初めて訊く（前もって名前を付けさせない）
    expect(host.textContent).toContain('この読み方に名前を付けて保存しますか？')
    const input = host.querySelector('.recipe-name')
    expect(input.value).toBe('仕入先マスタ')      // ファイル名から年を落とした見当
    input.value = '仕入先マスタ'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    button('保存する').click()
    await settle()
    expect(host.textContent).toContain('レシピ「仕入先マスタ」として保存しました')

    // 来月の同じ帳票（中身は違う・形は同じ）
    await openMapperWith('商品ｺｰﾄﾞ,商品名,単位,仕入単価\n99,ミルク,本,240', '仕入先マスタ_2026.csv')
    expect(questionText()).toBe('')                 // 問いは1つも出ない
    expect(host.textContent).toContain('レシピ「仕入先マスタ」で読みました')
  })

  it('レシピで読んだファイルでは、保存をもう一度訊かない', async () => {
    await mountSettings()
    await openMapperWith(FILE, '仕入先マスタ.csv')
    await tapHeaderRow(0)
    await finishImport()
    button('保存する').click()
    await settle()

    await openMapperWith(FILE, '仕入先マスタ.csv')
    host.querySelector('.imp-go').click()
    await settle()
    button('取り込む').click()
    await settle()
    expect(host.textContent).not.toContain('この読み方に名前を付けて保存しますか？')
  })

  it('保存したレシピは設定から消せる', async () => {
    await mountSettings()
    await openMapperWith(FILE, '仕入先マスタ.csv')
    await tapHeaderRow(0)
    await finishImport()
    button('保存する').click()
    await settle()

    expect(host.textContent).toContain('保存したレシピ（1）')
    button('削除').click()
    await settle()
    expect(host.textContent).not.toContain('保存したレシピ')
  })
})
