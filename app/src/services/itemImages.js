// 品目の画像（R2）。端末で圧縮してから Worker へ送る。
//
// - 一覧の丸い画像（thumb）: 中央を正方形に切り抜いて 128px
// - 大きく見る用（full）: 長い辺を 800px まで
// 形式は WebP（端末が書き出せなければ JPEG）。保存先の参照は '<店舗コード>/<id>' で
// 品目設定（config.images）に持つ。ゲストもこの参照から同じ URL を組める。
import { HTTP_BASE, apiFetch } from '../utils/api.js'
import { shopCode } from '../composables/useStore.js'

export const THUMB_PX = 128
export const FULL_PX  = 800
const FULL_MAX_BYTES  = 680 * 1024
const THUMB_MAX_BYTES = 60 * 1024

const REF_RE = /^[A-Z]{4,8}\/[0-9a-f]{32}$/i

/** 画像の URL（v: 't' 一覧用 / 'f' 大きく見る用）。参照が不正なら null */
export function itemImageUrl(ref, v = 't') {
  if (!HTTP_BASE || typeof ref !== 'string' || !REF_RE.test(ref)) return null
  return `${HTTP_BASE}/img/${ref}/${v}`
}

/** 画像を保存できる状態か（店舗にログインしていて、Worker が設定されている） */
export function canUploadItemImage() {
  return !!HTTP_BASE && !!shopCode.value
}

async function _decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch (_) { /* 下へ */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function _toBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

// WebP で書き出し、書き出せない端末（古い Safari 等は PNG になる）は JPEG にする。
// 上限を超えたら画質を下げて書き直す。
async function _encode(canvas, maxBytes) {
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    let blob = await _toBlob(canvas, 'image/webp', q)
    if (!blob || blob.type !== 'image/webp') blob = await _toBlob(canvas, 'image/jpeg', q)
    if (blob && blob.size <= maxBytes) return blob
  }
  throw new Error('画像を小さくできませんでした')
}

/**
 * 画像ファイルを一覧用・大きく見る用の2つに圧縮する。
 * @returns {Promise<{ thumb: Blob, full: Blob }>}
 */
export async function compressItemImage(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('画像ファイルを選んでください')
  const src = await _decode(file)
  const w = src.width, h = src.height
  if (!w || !h) throw new Error('画像を読み取れませんでした')

  const side = Math.min(w, h)
  const t = document.createElement('canvas')
  t.width = t.height = THUMB_PX
  t.getContext('2d').drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, THUMB_PX, THUMB_PX)

  const scale = Math.min(1, FULL_PX / Math.max(w, h))
  const f = document.createElement('canvas')
  f.width = Math.round(w * scale)
  f.height = Math.round(h * scale)
  f.getContext('2d').drawImage(src, 0, 0, f.width, f.height)
  src.close?.()

  return { thumb: await _encode(t, THUMB_MAX_BYTES), full: await _encode(f, FULL_MAX_BYTES) }
}

/** 圧縮済みの2つを保存して参照を返す */
export async function uploadItemImage({ thumb, full }) {
  const code = (shopCode.value || '').toUpperCase()
  if (!code) throw new Error('店舗にログインしていません')
  const fd = new FormData()
  fd.append('thumb', thumb, 'thumb')
  fd.append('full', full, 'full')
  const { id } = await apiFetch(`/store/${code}/images`, { method: 'POST', body: fd })
  return `${code}/${id}`
}

/** 保存先から消す（失敗しても品目の操作は止めない。残った画像はアカウント削除で消える） */
export async function deleteItemImage(ref) {
  if (typeof ref !== 'string' || !REF_RE.test(ref)) return
  const [code, id] = ref.split('/')
  if (code !== (shopCode.value || '').toUpperCase()) return   // 他の店舗の画像は消せない（サーバーも拒否する）
  try { await apiFetch(`/store/${code}/images/${id}`, { method: 'DELETE' }) } catch (_) { /* 残っても害は無い */ }
}
