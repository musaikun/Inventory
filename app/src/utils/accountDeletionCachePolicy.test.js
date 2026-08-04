import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')
const pushWorker = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8')

describe('PLAY-002: Cache API / Service Worker のaccount data境界', () => {
  it('Workbox runtime cacheは公開静的assetだけで、account/API応答を保存しない', () => {
    const runtimeCaching = viteConfig.match(/runtimeCaching:\s*\[([\s\S]*?)\n\s*\],/)?.[1] ?? ''
    expect(runtimeCaching).toMatch(/cacheName:\s*'fonts'/)
    expect(runtimeCaching).toMatch(/cacheName:\s*'pdf-cmaps'/)
    expect(runtimeCaching).not.toMatch(/\/(?:api|auth|store|room)\//i)
  })

  it('Push用Service Workerは通知だけを扱い、永続storageを作らない', () => {
    expect(pushWorker).toMatch(/addEventListener\('push'/)
    expect(pushWorker).not.toMatch(/\bcaches\b|indexedDB|localStorage/i)
  })
})
