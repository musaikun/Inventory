// 参加者別（担当者別の入力品目一覧）が、変更履歴の 200件上限に影響されないこと。
//
// 以前は auditLog（操作の履歴）から「品目ごとの最終更新者」を逆算していた。
// auditLog は端末・DO とも 200件で古い方から捨てるため、品目数がそれを超えると
// 古い品目の担当者が分からなくなり、参加者別からまるごと抜け落ちていた
// （530品目なら 330品目ぶんが不明）。
//
// 担当は「在庫データが品目ごとに持つ enteredBy / updatedAt」を正とする。
// 在庫側は品目ごとに1件なので、品目数がいくつでも全件に担当が付く。
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function freshHistory() {
  vi.resetModules()
  const mod = await import('./useHistory.js')
  return mod.useHistory()
}

const S1 = 'sess-1'

// name の担当で n 品目ぶんの在庫を作る
function inventoryOf(n, name, startAt = 1_700_000_000_000) {
  const inv = {}
  for (let i = 0; i < n; i++) {
    inv[`品目${i}`] = { qty: i + 1, unit: '個', enteredBy: name, updatedAt: startAt + i * 60_000 }
  }
  return inv
}
const orderOf = (n) => Array.from({ length: n }, (_, i) => `品目${i}`)

const build = (h, inv, auditLog = []) =>
  h.buildSnapshot(inv, {}, orderOf(Object.keys(inv).length), {}, Object.keys(inv), auditLog, null, null, S1)

beforeEach(() => localStorage.clear())

describe('参加者別は品目数に関係なく全件そろう', () => {
  it('530品目・変更履歴が200件でも、530品目すべてに担当が付く', async () => {
    const h = await freshHistory()
    const inv = inventoryOf(530, '端末A')
    // 変更履歴は上限で切られて直近200件しか無い状態
    const audit = orderOf(530).slice(330).map((item, i) => ({
      id: `a-${i}`, ingredient: item, action: 'new', enteredBy: '端末A', timestamp: 1_700_000_000_000 + i,
    }))

    const built = build(h, inv, audit)
    expect(built.participants).toHaveLength(1)
    expect(built.participants[0].name).toBe('端末A')
    expect(built.participants[0].items).toHaveLength(530)
  })

  it('変更履歴が空でも担当が付く（ソロ・再読込のあと）', async () => {
    const h = await freshHistory()
    const built = build(h, inventoryOf(3, '端末A'), [])
    expect(built.participants[0].items).toHaveLength(3)
  })

  it('担当ごとに分かれ、同名は1人にまとまる', async () => {
    const h = await freshHistory()
    const inv = {
      ...inventoryOf(2, '端末A'),
      レタス: { qty: 5, unit: '個', enteredBy: '端末B', updatedAt: 1_700_000_100_000 },
    }
    const built = build(h, inv, [])
    expect(built.participants.map(p => [p.name, p.items.length]).sort())
      .toEqual([['端末A', 2], ['端末B', 1]])
  })

  it('品目ごとの入力時刻 at を持つ（「いつ」の表示に使う）', async () => {
    const h = await freshHistory()
    const built = build(h, inventoryOf(2, '端末A'), [])
    expect(built.participants[0].items.map(it => it.at))
      .toEqual([1_700_000_000_000, 1_700_000_060_000])
  })

  it('未入力（qty null）の品目は割り当てない', async () => {
    const h = await freshHistory()
    const inv = { トマト: { qty: 3, unit: '個', enteredBy: '端末A', updatedAt: 1 } }
    // order に無い品目は未入力として items に入る
    const built = h.buildSnapshot(inv, {}, ['トマト', 'レタス'], {}, ['トマト'], [], null, null, S1)
    expect(built.items).toHaveLength(2)
    expect(built.participants[0].items.map(it => it.item)).toEqual(['トマト'])
  })

  it('在庫に enteredBy が無い古い下書きは、変更履歴から補う', async () => {
    const h = await freshHistory()
    const inv = { トマト: { qty: 3, unit: '個' } }   // 0.78.1 以前の下書き
    const audit = [{ id: 'a-1', ingredient: 'トマト', action: 'new', enteredBy: '端末A', timestamp: 1 }]
    const built = build(h, inv, audit)
    expect(built.participants[0].name).toBe('端末A')
    expect(built.participants[0].items[0].at).toBe(null)
  })

  it('担当が分からない品目はどこにも割り当てない（誤って誰かに付けない）', async () => {
    const h = await freshHistory()
    const built = build(h, { トマト: { qty: 3, unit: '個' } }, [])
    expect(built.participants).toBe(null)
  })

  it('フラグ操作だけの変更履歴では担当にしない', async () => {
    const h = await freshHistory()
    const inv = { トマト: { qty: 3, unit: '個' } }
    const audit = [{ id: 'a-1', ingredient: 'トマト', action: 'flag_recount', enteredBy: '端末A', timestamp: 1 }]
    expect(build(h, inv, audit).participants).toBe(null)
  })
})
