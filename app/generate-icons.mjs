// タナオロ アイコン生成スクリプト
// node generate-icons.mjs で実行
import { createCanvas } from 'canvas'
import { writeFileSync } from 'fs'

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx    = canvas.getContext('2d')
  const r      = size * 0.14   // 角丸半径

  // 背景グラデーション（ブランドカラー: #2563eb 〜 #1d4ed8）
  const grad = ctx.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, '#2563eb')
  grad.addColorStop(1, '#1d4ed8')

  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(size - r, 0)
  ctx.quadraticCurveTo(size, 0, size, r)
  ctx.lineTo(size, size - r)
  ctx.quadraticCurveTo(size, size, size - r, size)
  ctx.lineTo(r, size)
  ctx.quadraticCurveTo(0, size, 0, size - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  const cx = size / 2
  const cy = size / 2
  const s  = size / 512

  // クリップボード本体
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  const bx = 140 * s, by = 110 * s, bw = 232 * s, bh = 290 * s, br = 18 * s
  ctx.beginPath()
  ctx.moveTo(bx + br, by)
  ctx.lineTo(bx + bw - br, by)
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br)
  ctx.lineTo(bx + bw, by + bh - br)
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh)
  ctx.lineTo(bx + br, by + bh)
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br)
  ctx.lineTo(bx, by + br)
  ctx.quadraticCurveTo(bx, by, bx + br, by)
  ctx.closePath()
  ctx.fill()

  // クリップ部分（上部タブ）
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  const tx = 196 * s, ty = 90 * s, tw = 120 * s, th = 36 * s, tr = 10 * s
  ctx.beginPath()
  ctx.moveTo(tx + tr, ty)
  ctx.lineTo(tx + tw - tr, ty)
  ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + tr)
  ctx.lineTo(tx + tw, ty + th)
  ctx.lineTo(tx, ty + th)
  ctx.lineTo(tx, ty + tr)
  ctx.quadraticCurveTo(tx, ty, tx + tr, ty)
  ctx.closePath()
  ctx.fill()

  // チェックリスト 3行
  ctx.fillStyle = '#fff'
  const lineY = [190, 245, 300]
  lineY.forEach((y, i) => {
    const yy = y * s
    // チェックボックス
    const checked = i < 2
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth   = 10 * s
    ctx.strokeRect(170 * s, yy - 14 * s, 28 * s, 28 * s)
    if (checked) {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth   = 9 * s
      ctx.beginPath()
      ctx.moveTo(173 * s, yy + 1 * s)
      ctx.lineTo(180 * s, yy + 10 * s)
      ctx.lineTo(195 * s, yy - 8 * s)
      ctx.stroke()
    }
    // テキスト線（角丸矩形で表現）
    ctx.fillStyle = i === 2 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)'
    const lw = i === 2 ? 70 : 100
    ctx.beginPath()
    ctx.roundRect(212 * s, yy - 8 * s, lw * s, 16 * s, 4 * s)
    ctx.fill()
  })

  // マイクアイコン（右下）
  const mx = 330 * s, my = 340 * s, mr = 28 * s
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  // マイク本体
  ctx.beginPath()
  ctx.roundRect(mx - 10 * s, my - 26 * s, 20 * s, 36 * s, 10 * s)
  ctx.fill()
  // マイクアーク
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth   = 7 * s
  ctx.beginPath()
  ctx.arc(mx, my + 10 * s, 22 * s, Math.PI, 2 * Math.PI, true)
  ctx.stroke()
  // スタンド
  ctx.beginPath()
  ctx.moveTo(mx, my + 32 * s)
  ctx.lineTo(mx, my + 44 * s)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(mx - 14 * s, my + 44 * s)
  ctx.lineTo(mx + 14 * s, my + 44 * s)
  ctx.stroke()

  return canvas.toBuffer('image/png')
}

try {
  const buf192 = drawIcon(192)
  const buf512 = drawIcon(512)
  writeFileSync('public/icon-192.png', buf192)
  writeFileSync('public/icon-512.png', buf512)
  console.log('✓ icons generated')
} catch (e) {
  console.error('canvas not available, skipping icon generation:', e.message)
}
