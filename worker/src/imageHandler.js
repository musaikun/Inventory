// 品目の画像（R2）。
//
// 置き場所: `<店舗コード>/<id>_t`（一覧の丸い画像・128px）と `<id>_f`（大きく見る用・〜800px）。
// 圧縮は端末で済ませてから送る（Worker で画像を処理しない）。
//
// 読み出し（GET /img/...）は**認証を見ない**。<img> はヘッダーを付けられないため。
// 代わりに id を推測できない乱数（128bit）にして、品目設定（＝店舗のメンバーとセッションの参加者）を
// 持つ人にしか URL が分からない形にする。バケット自体は公開しない（R2 の公開設定は off のまま）。
// 書き込み・削除は店舗トークン必須（index.js が _requireAuth を通してから呼ぶ）。

export const IMAGE_MAX_BYTES = { t: 64 * 1024, f: 700 * 1024 }
export const IMAGE_UPLOAD_MAX_BYTES = 1024 * 1024
const ID_RE = /^[0-9a-f]{32}$/

export function isImageId(id) { return typeof id === 'string' && ID_RE.test(id) }

function _newId() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('')
}

// 中身で形式を確かめる（申告の Content-Type は信用しない）
export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46        // RIFF
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {   // WEBP
    return 'image/webp'
  }
  return null
}

const _key = (code, id, v) => `${code}/${id}_${v}`

/**
 * POST /store/:code/images（multipart: thumb, full）→ { id }
 */
export async function handleImageUpload(bucket, code, request) {
  if (!bucket) return { _status: 503, error: '画像の保存先が設定されていません' }
  const declared = Number(request.headers.get('Content-Length') ?? '')
  if (Number.isFinite(declared) && declared > IMAGE_UPLOAD_MAX_BYTES) {
    return { _status: 413, error: '画像が大きすぎます' }
  }
  let form
  try { form = await request.formData() } catch (_) { return { _status: 400, error: '画像を読み取れませんでした' } }

  const parts = {}
  for (const [field, v] of [['thumb', 't'], ['full', 'f']]) {
    const file = form.get(field)
    if (!file || typeof file.arrayBuffer !== 'function') return { _status: 400, error: '画像がありません' }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES[v]) return { _status: 413, error: '画像が大きすぎます' }
    const type = sniffImageType(bytes)
    if (!type) return { _status: 415, error: 'JPEG か WebP の画像を送ってください' }
    parts[v] = { bytes, type }
  }

  const id = _newId()
  for (const v of ['t', 'f']) {
    await bucket.put(_key(code, id, v), parts[v].bytes, { httpMetadata: { contentType: parts[v].type } })
  }
  return { ok: true, id }
}

/** DELETE /store/:code/images/:id */
export async function handleImageDelete(bucket, code, id) {
  if (!bucket) return { _status: 503, error: '画像の保存先が設定されていません' }
  if (!isImageId(id)) return { _status: 400, error: '画像の指定が不正です' }
  await bucket.delete([_key(code, id, 't'), _key(code, id, 'f')])
  return { ok: true }
}

/** GET /img/:code/:id/:v → 画像そのもの（無ければ 404） */
export async function handleImageGet(bucket, code, id, v) {
  if (!bucket || !isImageId(id) || (v !== 't' && v !== 'f')) return new Response('Not found', { status: 404 })
  const obj = await bucket.get(_key(code, id, v))
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      // id ごとに中身は変わらない（差し替えは新しい id になる）ので、長くキャッシュしてよい
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** 店舗の画像を全部消す（アカウント削除） */
export async function purgeShopImages(bucket, code) {
  if (!bucket) return
  let cursor
  do {
    const page = await bucket.list({ prefix: `${code}/`, cursor })
    const keys = page.objects.map(o => o.key)
    if (keys.length) await bucket.delete(keys)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}
