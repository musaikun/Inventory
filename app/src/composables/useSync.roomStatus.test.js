import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let fetchMock

beforeEach(() => {
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ isActive: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function load() {
  vi.resetModules()
  return (await import('./useSync.js')).fetchRoomStatus
}

describe('fetchRoomStatus: sessionId はリンクの鍵を添えたときだけ照合を頼む', () => {
  it('sessionId を渡すと ?s= を付ける（発注ルームは type と併記）', async () => {
    const fetchRoomStatus = await load()
    await fetchRoomStatus('ABCDEF', 'stock', 'sid-1')
    await fetchRoomStatus('ABCDEF', 'order', 'sid 2')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/room\/ABCDEF\/status\?s=sid-1$/)
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/room\/ABCDEF\/status\?type=order&s=sid\+2$/)
  })

  it('sessionId 無しは従来どおりのURL', async () => {
    const fetchRoomStatus = await load()
    await fetchRoomStatus('ABCDEF')
    await fetchRoomStatus('ABCDEF', 'order')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/room\/ABCDEF\/status$/)
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/room\/ABCDEF\/status\?type=order$/)
  })
})
