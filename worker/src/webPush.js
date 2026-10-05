/**
 * Web Push を WebCrypto だけで送る（RFC 8291 aes128gcm 暗号化 + RFC 8292 VAPID）。
 *
 * 以前は npm の `web-push` を使っていたが、あれは Node の `crypto.createECDH` と `https` に頼るため
 * Cloudflare Workers（nodejs_compat）では送信が失敗する。本番に VAPID 鍵が入るまで送信が一度も
 * 走っていなかったので気づかなかった（2026-10-05、テストの通知が送れないことで判明）。
 *
 * 鍵の形は web-push の generateVAPIDKeys と同じ（base64url。公開鍵は非圧縮 65 バイト、秘密鍵は 32 バイト）。
 */

const te = new TextEncoder()

export function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
export function bytesToB64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** VAPID の JWT（ES256）。aud は送り先のオリジン */
export async function vapidJwt(endpoint, { publicKey, privateKey, subject }, nowSec = Math.floor(Date.now() / 1000)) {
  const pub = b64urlToBytes(publicKey)
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: privateKey,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = bytesToB64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = bytesToB64url(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: nowSec + 12 * 3600,
    sub: subject || 'mailto:support@tanaoro.com',
  })))
  const unsigned = `${header}.${body}`
  // WebCrypto の ECDSA 署名は r||s（64 バイト）。JWS の ES256 と同じ形
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned)))
  return `${unsigned}.${bytesToB64url(sig)}`
}

/**
 * 本文を端末の鍵で暗号化する（RFC 8291 / RFC 8188 aes128gcm、1レコード）。
 * @returns {Promise<Uint8Array>} そのまま POST する本文
 */
export async function encryptPayload(plaintext, { p256dh, auth }, { salt, serverKeys } = {}) {
  const uaPublic = b64urlToBytes(p256dh)
  const authSecret = b64urlToBytes(auth)
  const keys = serverKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, keys.privateKey, 256))
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16))

  const prkKey = await hmac(authSecret, ecdhSecret)
  const ikm = await hmac(prkKey, concat(te.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))
  const prk = await hmac(s, ikm)
  const cek = (await hmac(prk, te.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16)
  const nonce = (await hmac(prk, te.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12)

  const data = typeof plaintext === 'string' ? te.encode(plaintext) : plaintext
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(data, new Uint8Array([2]))))

  const rs = new Uint8Array([0, 0, 0x10, 0])   // record size 4096
  return concat(s, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

/**
 * 1件送る。戻り値は送り先の HTTP ステータス（201 などで成功、404/410 は購読が消えている）。
 * @param {{endpoint:string,p256dh:string,auth:string}} sub
 */
export async function sendWebPush(sub, payload, vapid, { ttl = 86400, fetchImpl = fetch } = {}) {
  const jwt = await vapidJwt(sub.endpoint, vapid)
  const body = await encryptPayload(JSON.stringify(payload), sub)
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
    },
    body,
  })
  return res.status
}
