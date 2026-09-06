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
const orderValue = () => host.querySelector('.order-qty-value').textContent.trim()
async function typeStock(digits) {
  // 発注モードのテンキーは既定で発注数を編集する。在庫欄をタップして対象を切り替える
  host.querySelector('.qty-row .qty-display').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  for (const d of String(digits)) {
    button(d).click()
    await nextTick()
  }
}

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
    expect(host.textContent).toContain('補充目標: 24')
    expect(host.querySelector('.order-basis').textContent).toContain('発注点 12 × 2')
  })

  it('学習が無くても、補充目標と在庫から推奨が出る', async () => {
    await mount({ parLevel: null, replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(8)
    // 不足16 → 入数12で1ケース
    expect(host.textContent).toContain('推奨: 1')
  })

  it('推奨は参考として出すだけで、発注数へは自動で入れない', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(8)
    expect(host.textContent).toContain('推奨: 1')   // 参考としては出す
    // 発注数はまだ入力欄ですらない（読むだけの目安）。確定しても発注は付かない
    expect(host.querySelector('.order-qty-value'), '入力欄は出ていない').toBeNull()
    expect(button('発注なしで確定'), '確定しても0のまま').not.toBeUndefined()

    button('自分で決める').click(); await nextTick()
    expect(orderValue()).toBe('0')                 // 切り替えても推奨は入らない
  })

  it('推奨はタップで採用でき、そこから直せる', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(2)
    button('推奨: 1').click()
    await nextTick()
    expect(orderValue()).toBe('1')
    button('＋').click()
    await nextTick()
    expect(orderValue()).toBe('2')
  })

  it('足りていれば発注しない', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' } })
    await typeStock(24)
    expect(button('発注なしで確定')).not.toBeUndefined()

    button('自分で決める').click(); await nextTick()
    expect(orderValue()).toBe('0')
  })

  it('補充目標が無ければ推奨を出さず、発注点を入れるよう案内する', async () => {
    await mount({ replenish: null, parLevel: null })
    await typeStock(8)
    expect(host.textContent).not.toContain('推奨:')
    expect(host.querySelector('.order-note').textContent).toContain('発注点を入れる')
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
    expect(host.querySelector('.qty-display').textContent.trim()).toBe('7')
    expect(host.querySelector('.order-qty-value'), '発注数は入力欄ではない').toBeNull()
  })

  it('発注数は読むだけの目安で、自分で決めるまで入力欄にならない', async () => {
    await mount({ replenish: { value: 24, source: 'reorder', basis: 'x' }, orderLot: 12 })
    await typeStock(0)

    const guide = host.querySelector('.order-guide')
    expect(guide, '目安の行が出る').not.toBeNull()
    expect(guide.textContent).toContain('目安')

    button('自分で決める').click(); await nextTick()
    expect(host.querySelector('.order-guide')).toBeNull()
    expect(host.querySelector('.order-qty-value')).not.toBeNull()
  })

  it('「あとで決める」は在庫つきの保留として確定する', async () => {
    const events = await mount({ targetLevel: 14 })
    await typeStock(6)
    button('あとで決める').click(); await nextTick()

    expect(events.confirm.length).toBe(1)
    expect(events.confirm[0]).toMatchObject({ orderQty: 0, stock: 6 })
  })

  it('在庫を入れずに「あとで決める」は確定しない（残すものが無い）', async () => {
    const events = await mount({ targetLevel: 14 })
    button('あとで決める').click(); await nextTick()

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

  it('いま打っている欄と値を、キーの上に出し続ける', async () => {
    // キーを下に貼り付けると、編集中の行がキーの裏に隠れることがある
    await mount({ targetLevel: 14, orderLot: 12 })
    const now = () => host.querySelector('.dock-now').textContent.replace(/\s+/g, '')
    // 既定は在庫。棚の前で先に分かるのは「いま何個あるか」
    expect(now()).toContain('現在在庫')

    button('9').click(); await nextTick()
    expect(now()).toContain('9')

    button('自分で決める').click(); await nextTick()  // 発注数を自分で決める
    button('3').click(); await nextTick()
    expect(now()).toContain('発注数')
    expect(now()).toContain('3')

    await typeStock(8)                       // 在庫欄へ戻して入力
    expect(now()).toContain('現在在庫')
    expect(now()).toContain('98')
    // 切り替えても発注数は保たれている
    expect(orderValue()).toBe('3')
  })
})
