import { describe, it, expect, beforeEach, vi } from 'vitest'

// D-019: アカウント削除の完了時だけ端末ID・端末名を消す。
// 通常運用（ログアウト・アカウント切替）では変わらないことは accountData.test.js で担保する。

async function fresh() {
  vi.resetModules()
  return import('./useDeviceId.js')
}

beforeEach(() => { localStorage.clear() })

describe('useDeviceId: 初期化', () => {
  it('保存済みIDがあればそれを使う', async () => {
    localStorage.setItem('_device_id', 'dev-old')
    localStorage.setItem('_device_name', 'レジ')

    const m = await fresh()

    expect(m.deviceId).toBe('dev-old')
    expect(m.deviceName.value).toBe('レジ')
  })

  it('保存済みIDが無ければ採番して永続化する', async () => {
    const m = await fresh()

    expect(m.deviceId).toBeTruthy()
    expect(localStorage.getItem('_device_id')).toBe(m.deviceId)
    expect(m.deviceName.value).toBe('')
  })
})

describe('useDeviceId: resetLocalData（アカウント削除時のみ）', () => {
  it('保存済みの端末ID・端末名を消す', async () => {
    localStorage.setItem('_device_id', 'dev-old')
    localStorage.setItem('_device_name', 'レジ')
    const m = await fresh()

    m.resetLocalData()

    expect(localStorage.getItem('_device_id')).toBeNull()
    expect(localStorage.getItem('_device_name')).toBeNull()
    expect(m.deviceName.value).toBe('')
  })

  it('メモリ上のIDを別の値へ差し替える（削除済みアカウントのIDを送り続けない）', async () => {
    localStorage.setItem('_device_id', 'dev-old')
    const m = await fresh()
    expect(m.deviceId).toBe('dev-old')

    m.resetLocalData()

    // live binding 経由で import 側にも新しい値が見える
    expect(m.deviceId).toBeTruthy()
    expect(m.deviceId).not.toBe('dev-old')
  })

  it('reset 直後は永続化せず、次回起動で新しいIDが採番・保存される', async () => {
    localStorage.setItem('_device_id', 'dev-old')
    const m = await fresh()

    m.resetLocalData()
    expect(localStorage.getItem('_device_id')).toBeNull()

    // 次回起動（新規インストールと同じ初期化経路）
    const next = await fresh()

    expect(next.deviceId).toBeTruthy()
    expect(next.deviceId).not.toBe('dev-old')
    expect(localStorage.getItem('_device_id')).toBe(next.deviceId)
  })
})
