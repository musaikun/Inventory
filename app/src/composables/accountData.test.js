import { describe, it, expect, beforeEach, vi } from 'vitest'

// アカウント分離（クロスアカウント漏洩の修正）の検証。
async function fresh() {
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  vi.resetModules()
  const auth        = await import('./useAuth.js')
  const accountData = await import('./accountData.js')
  const orders      = await import('./useOrders.js')
  const movements   = await import('./useMovements.js')
  return { auth, accountData, orders, movements }
}

function stubLogin(shopCode) {
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ token: 'tok', shopCode, storeName: null }) }))
}

describe('clearLocalAccountData（ローカル業務データの全消去）', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

  it('発注・入出庫・ドラフト・ホストトークンを消し、端末設定は残す', async () => {
    const { accountData, orders, movements } = await fresh()

    orders.useOrders().saveOrder({ lines: [{ item: 'トマト', qty: 2 }] })
    movements.useMovements().saveMovement({ type: 'in', lines: [{ item: 'トマト', qty: 5 }] })
    localStorage.setItem('_host_token_ABCDEF', 'x')
    localStorage.setItem('inv_draft_s1', '{}')
    localStorage.setItem('order_draft_o1', '{}')
    localStorage.setItem('_device_id', 'dev-1')
    localStorage.setItem('_device_name', 'レジ')

    accountData.clearLocalAccountData()

    expect(orders.useOrders().getOrders()).toHaveLength(0)
    expect(movements.useMovements().getMovements()).toHaveLength(0)
    expect(localStorage.getItem('inventory_orders_v1')).toBeNull()
    expect(localStorage.getItem('inventory_movements_v1')).toBeNull()
    expect(localStorage.getItem('_host_token_ABCDEF')).toBeNull()
    expect(localStorage.getItem('inv_draft_s1')).toBeNull()
    expect(localStorage.getItem('order_draft_o1')).toBeNull()
    // 端末固有の設定は保持
    expect(localStorage.getItem('_device_id')).toBe('dev-1')
    expect(localStorage.getItem('_device_name')).toBe('レジ')
  })
})

describe('アカウント切替時の自動消去（漏洩防止の核）', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

  it('別アカウントでログインすると前アカウントのデータが消える', async () => {
    localStorage.setItem('_data_owner', 'AAAAAA')
    const { auth, orders } = await fresh()
    orders.useOrders().saveOrder({ lines: [{ item: 'A店の品', qty: 1 }] })

    const reset = vi.fn(() => orders.resetLocalData())
    auth.setAccountResetHandler(reset)

    stubLogin('BBBBBB')
    await auth.login('BBBBBB', '1234')

    expect(reset).toHaveBeenCalledTimes(1)
    expect(orders.useOrders().getOrders()).toHaveLength(0)
    expect(localStorage.getItem('_data_owner')).toBe('BBBBBB')
  })

  it('同じアカウントで再ログインしてもデータは消えない', async () => {
    localStorage.setItem('_data_owner', 'AAAAAA')
    const { auth, orders } = await fresh()
    orders.useOrders().saveOrder({ lines: [{ item: 'A店の品', qty: 1 }] })

    const reset = vi.fn(() => orders.resetLocalData())
    auth.setAccountResetHandler(reset)

    stubLogin('AAAAAA')
    await auth.login('AAAAAA', '1234')

    expect(reset).not.toHaveBeenCalled()
    expect(orders.useOrders().getOrders()).toHaveLength(1)
  })

  it('owner 未設定でも直前の店舗コード（_shop_code）で切替を検出する（既存インストール移行）', async () => {
    localStorage.setItem('_shop_code', 'AAAAAA')   // dataOwner は無い旧インストール
    const { auth } = await fresh()

    const reset = vi.fn()
    auth.setAccountResetHandler(reset)

    stubLogin('BBBBBB')
    await auth.login('BBBBBB', '1234')

    expect(reset).toHaveBeenCalledTimes(1)
  })
})
