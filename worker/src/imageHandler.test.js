import { describe, it, expect } from 'vitest'
import { handleImageUpload, handleImageDelete, handleImageGet, purgeShopImages, sniffImageType, IMAGE_MAX_BYTES } from './imageHandler.js'

function fakeBucket() {
  const store = new Map()
  return {
    store,
    async put(key, bytes, opts) { store.set(key, { bytes, type: opts?.httpMetadata?.contentType }) },
    async get(key) {
      const o = store.get(key)
      return o ? { body: o.bytes, httpMetadata: { contentType: o.type } } : null
    },
    async delete(keys) { for (const k of [].concat(keys)) store.delete(k) },
    async list({ prefix }) {
      return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }
    },
  }
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9])
const PNG  = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])

function uploadReq(thumb, full) {
  const fd = new FormData()
  if (thumb) fd.append('thumb', new Blob([thumb]), 't')
  if (full)  fd.append('full',  new Blob([full]),  'f')
  return new Request('https://w/store/ABCD/images', { method: 'POST', body: fd })
}

describe('品目の画像（R2）', () => {
  it('JPEG / WebP を見分け、それ以外は拒否する', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(WEBP)).toBe('image/webp')
    expect(sniffImageType(PNG)).toBeNull()
  })

  it('保存すると推測できない id を返し、店舗の下に2つ置く', async () => {
    const b = fakeBucket()
    const r = await handleImageUpload(b, 'ABCD', uploadReq(WEBP, JPEG))
    expect(r.ok).toBe(true)
    expect(r.id).toMatch(/^[0-9a-f]{32}$/)
    expect([...b.store.keys()].sort()).toEqual([`ABCD/${r.id}_f`, `ABCD/${r.id}_t`])
    expect(b.store.get(`ABCD/${r.id}_t`).type).toBe('image/webp')
  })

  it('形式が違う・大きすぎる・片方欠けは保存しない', async () => {
    const b = fakeBucket()
    expect((await handleImageUpload(b, 'ABCD', uploadReq(PNG, JPEG)))._status).toBe(415)
    const big = new Uint8Array(IMAGE_MAX_BYTES.t + 1); big.set(JPEG)
    expect((await handleImageUpload(b, 'ABCD', uploadReq(big, JPEG)))._status).toBe(413)
    expect((await handleImageUpload(b, 'ABCD', uploadReq(JPEG, null)))._status).toBe(400)
    expect(b.store.size).toBe(0)
  })

  it('読み出しは長くキャッシュし、無い id・不正な指定は 404', async () => {
    const b = fakeBucket()
    const { id } = await handleImageUpload(b, 'ABCD', uploadReq(WEBP, JPEG))
    const res = await handleImageGet(b, 'ABCD', id, 't')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('Cache-Control')).toContain('immutable')
    expect((await handleImageGet(b, 'WXYZ', id, 't')).status).toBe(404)   // 別の店舗の下には無い
    expect((await handleImageGet(b, 'ABCD', 'x', 't')).status).toBe(404)
  })

  it('削除と、店舗ごとの全削除（アカウント削除）', async () => {
    const b = fakeBucket()
    const a = await handleImageUpload(b, 'ABCD', uploadReq(WEBP, JPEG))
    await handleImageUpload(b, 'ABCD', uploadReq(WEBP, JPEG))
    await handleImageUpload(b, 'WXYZ', uploadReq(WEBP, JPEG))
    await handleImageDelete(b, 'ABCD', a.id)
    expect([...b.store.keys()].filter(k => k.startsWith('ABCD/')).length).toBe(2)
    await purgeShopImages(b, 'ABCD')
    expect([...b.store.keys()].every(k => k.startsWith('WXYZ/'))).toBe(true)
  })
})
