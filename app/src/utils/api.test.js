import { describe, it, expect, beforeEach, vi } from 'vitest'

async function importApi(envUrl) {
  vi.stubEnv('VITE_SYNC_WORKER_URL', envUrl)
  vi.resetModules()
  return import('./api.js')
}

describe('HTTP_BASE / WS_BASE 正規化', () => {
  it('https URL はそのまま・末尾スラッシュを除去・WSはwssに変換', async () => {
    const { HTTP_BASE, WS_BASE } = await importApi('https://sync.example.dev/')
    expect(HTTP_BASE).toBe('https://sync.example.dev')
    expect(WS_BASE).toBe('wss://sync.example.dev')
  })

  it('wss URL は https に変換される', async () => {
    const { HTTP_BASE, WS_BASE } = await importApi('wss://sync.example.dev')
    expect(HTTP_BASE).toBe('https://sync.example.dev')
    expect(WS_BASE).toBe('wss://sync.example.dev')
  })

  it('http URL は ws に変換される（ローカル開発）', async () => {
    const { HTTP_BASE, WS_BASE } = await importApi('http://localhost:8787')
    expect(HTTP_BASE).toBe('http://localhost:8787')
    expect(WS_BASE).toBe('ws://localhost:8787')
  })

  it('未設定なら空文字', async () => {
    const { HTTP_BASE, WS_BASE } = await importApi('')
    expect(HTTP_BASE).toBe('')
    expect(WS_BASE).toBe('')
  })
})

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('トークンがあれば Authorization ヘッダーを付ける', async () => {
    const { apiFetch } = await importApi('https://sync.example.dev')
    localStorage.setItem('_auth_token', 'tok123')
    let captured
    vi.stubGlobal('fetch', async (url, opts) => {
      captured = { url, opts }
      return { ok: true, json: async () => ({ ok: true }) }
    })
    await apiFetch('/store/ABCDEF/config')
    expect(captured.url).toBe('https://sync.example.dev/store/ABCDEF/config')
    expect(captured.opts.headers['Authorization']).toBe('Bearer tok123')
  })

  it('トークンが無ければ Authorization を付けない', async () => {
    const { apiFetch } = await importApi('https://sync.example.dev')
    let captured
    vi.stubGlobal('fetch', async (url, opts) => {
      captured = { url, opts }
      return { ok: true, json: async () => ({}) }
    })
    await apiFetch('/store/ABCDEF/config')
    expect(captured.opts.headers['Authorization']).toBeUndefined()
  })

  it('エラー応答は body.error をメッセージにして投げる', async () => {
    const { apiFetch } = await importApi('https://sync.example.dev')
    vi.stubGlobal('fetch', async () => ({
      ok: false, status: 401,
      json: async () => ({ error: '認証が必要です' }),
    }))
    await expect(apiFetch('/store/ABCDEF/config')).rejects.toThrow('認証が必要です')
  })

  it('エラー応答に error が無ければ HTTP ステータスを投げる', async () => {
    const { apiFetch } = await importApi('https://sync.example.dev')
    vi.stubGlobal('fetch', async () => ({
      ok: false, status: 500,
      json: async () => { throw new Error('not json') },
    }))
    await expect(apiFetch('/x')).rejects.toThrow('HTTP 500')
  })

  it('BASE 未設定なら reject する', async () => {
    const { apiFetch } = await importApi('')
    await expect(apiFetch('/x')).rejects.toThrow('WORKER_URL未設定')
  })
})
