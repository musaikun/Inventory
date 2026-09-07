// 発注モードの推奨（C: 発注数の決め方）の回帰。
// 守りたい契約:
//   ・目標は補充目標。発注点そのものへ戻すと補充直後にまた発注点を割る
//   ・学習（適正在庫）が無くても、発注点さえあれば推奨が出る（部分利用ファースト）
//   ・「自分で入力する」モードでは推奨を自動で入れない。どちらでも人が最後に直せる
//   ・推奨には必ず根拠を添える
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

async function mount(props) {
  const { default: Modal } = await import('./ConfirmModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const events = { confirm: [] }
  app = createApp({
    render: () => h(Modal, {
      ingredient: 'トマト', unit: '個',
      orderMode: true, orderLot: 12, initialQty: null,
      ...props,
      onConfirm: (p) => events.confirm.push(p),
      onCancel: () => {},
    }),
  })
  app.mount(host)
  await nextTick()
  return events
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}
// 打つ欄は1つ。単位の位置の切替が、いま在庫と発注数のどちらを映しているかを示す。
const shown = () => host.querySelector('.qty-display').textContent.trim()
const basis = () => host.querySelector('.basis-toggle')
const onOrder = () => basis().classList.contains('order')
const chip = label =>
  [...host.querySelectorAll('.hint-ref')].find(b => b.textContent.trim().startsWith(label))

async function type(digits) {
  for (const d of String(digits)) {
    button(d).click()
    await nextTick()
  }
}
/** 既定は在庫。念のため在庫側へ寄せてから打つ */
async function typeStock(digits) {
  if (onOrder()) { basis().click(); await nextTick() }
  await type(digits)
}
/** 発注数の表示値（切替が発注側にある前提） */
const orderValue = () => (onOrder() ? shown() : null)

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.resetModules()
})

describe('ConfirmModal — 発注モードの推奨', () => {
  it('補充目標を出し、根拠も添える', async () => {
    await mount({
      replenish: { value: 24, source: 'reorder', basis: '発注点 12 × 2（学習が貯まると自動で切り替わります）' },
    })
    expect(chip('補充目標').textContent).toContain('24')
    await typeStock(8)
    // 根拠は数字の隣に持たせる。専用の行を作ると、その1行のためにシートが伸びる
    expect(chip('推奨').getAttribute('title')).toContain('発注点 12 × 2')
  })

  it('学習が無くても、補充目標と在庫から推奨が出る', async () => {
    await mount({ parLevel: null, replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(8)
    // 不足16 → 入数12で1ケース
    expect(chip('推奨').textContent).toContain('1')
  })

  it('推奨は参考として出すだけで、発注数へは自動で入れない', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(8)
    expect(chip('推奨'), '参考としては出す').not.toBeUndefined()
    expect(onOrder(), '打っているのは在庫のまま').toBe(false)
    expect(button('発注なしで確定'), '確定しても0のまま').not.toBeUndefined()

    basis().click(); await nextTick()
    expect(orderValue()).toBe('0')                 // 切り替えても推奨は入らない
  })

  it('推奨はタップで採用でき、そこから直せる', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(2)
    chip('推奨').click()
    await nextTick()
    expect(onOrder(), '採用すると上の欄が発注数へ切り替わる').toBe(true)
    expect(orderValue()).toBe('1')

    await type(3)                                   // そのままテンキーで直せる
    expect(orderValue()).toBe('13')
  })

  it('足りていれば発注しない', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(24)
    expect(button('発注なしで確定')).not.toBeUndefined()

    basis().click(); await nextTick()
    expect(orderValue()).toBe('0')
  })

  it('補充目標が無ければ推奨を出さず、発注点を入れるよう案内する', async () => {
    await mount({ replenish: null, parLevel: null })
    await typeStock(8)
    expect(chip('推奨')).toBeUndefined()
    expect(chip('補充目標').textContent).toContain('未設定')
    expect(chip('補充目標').getAttribute('title')).toContain('発注点を入れる')
  })
})

// User報告 2026-09-05:「数字の入力中にモーダル内の表示がずれて誤操作が頻発」。
// 実機（390×740）で測ると、最初の1打でシートが 289px 自動スクロールしていた。
// テンキーの一部が画面外にあるので、そこを押すとブラウザが「押された要素を見せる」ために
// シートを送り、キー全体が指の下でずれる。次の一打が別のキーに当たる。
// Userの実運用: 発注セッションでは在庫数を入れることが多かった。棚の前で適正な
// 発注量までは判断できず、在庫を記録して後から詳しい人や社内の入出庫情報と
// 突き合わせて決めていた。打つのは在庫ひとつ、発注数は読むだけの目安にする。
describe('打つのは在庫ひとつ', () => {
  it('既定の入力先は在庫（最初の一打が在庫へ入る）', async () => {
    await mount({ targetLevel: 14 })
    button('7').click(); await nextTick()
    expect(shown()).toBe('7')
    expect(onOrder(), '発注数ではない').toBe(false)
  })

  it('打つ欄は1つで、単位の位置の切替で在庫と発注数を入れ替える', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' }, orderLot: 12 })
    await typeStock(8)
    expect(shown()).toBe('8')
    expect(basis().textContent).toContain('在庫')

    basis().click(); await nextTick()
    expect(basis().textContent).toContain('発注')
    expect(shown(), '発注数はまだ0（推奨は自動で入らない）').toBe('0')

    await type(2)
    expect(shown()).toBe('2')

    basis().click(); await nextTick()
    expect(shown(), '在庫へ戻すと打った在庫がそのまま出る').toBe('8')
  })

  it('「後で」は在庫つきの保留として確定する', async () => {
    const events = await mount({ targetLevel: 14 })
    await typeStock(6)
    button('後で').click(); await nextTick()

    expect(events.confirm.length).toBe(1)
    expect(events.confirm[0]).toMatchObject({ orderQty: 0, stock: 6 })
  })

  it('在庫を入れずに「後で」は確定しない（残すものが無い）', async () => {
    const events = await mount({ targetLevel: 14 })
    button('後で').click(); await nextTick()

    expect(events.confirm.length).toBe(0)
    expect(host.querySelector('.qty-display').classList.contains('error')).toBe(true)
  })
})

describe('打つ場所が動かない', () => {
  it('理論在庫とのズレは出さない（1打ごとに行が出入りしていた）', async () => {
    await mount({ theoStock: { qty: 8 }, targetLevel: 14 })
    // 在庫を入れてもズレの行は出ない
    await typeStock(9)
    expect(host.querySelector('.theo-drift')).toBeNull()
    expect(host.textContent).not.toContain('理論在庫より')
  })

  it('テンキーと確定は、シートの下に貼り付けた1つの塊にまとまっている', async () => {
    await mount({ targetLevel: 14 })
    const dock = host.querySelector('.keypad-dock')
    expect(dock, 'ドックがある').not.toBeNull()
    expect(dock.querySelector('.numpad'), 'テンキーが入っている').not.toBeNull()
    expect(dock.querySelector('.actions'), '確定が入っている').not.toBeNull()
  })

  // 元は貼り付けたキーの上に「いま打っている欄」を出していた（キーの裏に隠れるため）。
  // 欄を1つにして貼り付けをやめたので、その役目は上の欄そのものが果たす。
  it('打っている値は常に上の欄に出ており、切り替えても失われない', async () => {
    await mount({ targetLevel: 14, orderLot: 12 })
    // 既定は在庫。棚の前で先に分かるのは「いま何個あるか」
    expect(basis().textContent).toContain('在庫')

    button('9').click(); await nextTick()
    expect(shown()).toBe('9')

    basis().click(); await nextTick()
    await type(3)
    expect(basis().textContent).toContain('発注')
    expect(shown()).toBe('3')

    await typeStock(8)                       // 在庫へ戻して続きを打つ
    expect(basis().textContent).toContain('在庫')
    expect(shown()).toBe('98')

    basis().click(); await nextTick()
    expect(shown(), '切り替えても発注数は保たれている').toBe('3')
  })
})
