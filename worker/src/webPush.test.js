// Web Push を WebCrypto で送る（Workers では web-push が動かないため・2026-10-05）。
// 参照実装（http_ece の復号・jws の検証・web-push の鍵生成）で、正しく読めることを確かめる。
import { describe, it, expect, vi } from 'vitest'
import { createECDH, createPublicKey } from 'node:crypto'
import ece from 'http_ece'
import jws from 'jws'
import webpushLib from 'web-push'
import { encryptPayload, vapidJwt, sendWebPush, b64urlToBytes } from './webPush.js'

function deviceKeys() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
  return { ecdh, sub: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') }, auth }
}

describe('webPush', () => {
  it('端末側（http_ece）で復号できる', async () => {
    const { ecdh, sub, auth } = deviceKeys()
    const body = await encryptPayload(JSON.stringify({ title: 'タナオロ', body: '通知のテスト🔔' }), sub)
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth })
    expect(JSON.parse(plain.toString('utf8'))).toEqual({ title: 'タナオロ', body: '通知のテスト🔔' })
  })

  it('VAPID の JWT は公開鍵で検証でき、aud は送り先のオリジン', async () => {
    const vapid = webpushLib.generateVAPIDKeys()
    const jwt = await vapidJwt('https://fcm.googleapis.com/fcm/send/abc', { ...vapid, subject: 'mailto:a@b.c' }, 1000)
    const pub = b64urlToBytes(vapid.publicKey)
    const pem = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(pub.slice(1, 33)).toString('base64url'), y: Buffer.from(pub.slice(33)).toString('base64url') }, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' })
    expect(jws.verify(jwt, 'ES256', pem)).toBe(true)
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
    expect(payload).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600, sub: 'mailto:a@b.c' })
  })

  it('送り先へ暗号化した本文と VAPID の見出しで POST し、状態コードを返す', async () => {
    const { ecdh, sub, auth } = deviceKeys()
    const vapid = webpushLib.generateVAPIDKeys()
    const fetchImpl = vi.fn(async () => ({ status: 201 }))
    const st = await sendWebPush({ endpoint: 'https://web.push.apple.com/x', ...sub }, { body: 'やあ' }, vapid, { fetchImpl })
    expect(st).toBe(201)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://web.push.apple.com/x')
    expect(init.headers.Authorization).toMatch(new RegExp(`^vapid t=.+\\..+\\..+, k=${vapid.publicKey}$`))
    expect(init.headers['Content-Encoding']).toBe('aes128gcm')
    const plain = ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth })
    expect(JSON.parse(plain.toString())).toEqual({ body: 'やあ' })
  })
})
