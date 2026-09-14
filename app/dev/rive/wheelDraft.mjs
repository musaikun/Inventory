// AxisAssignFocus.vueの色・寸法を参考にした、素材検討用の2D投影。
// Riveの実行結果ではない。業務データは使わず、ラベルは表示用の仮データ。
export const REFERENCE_DURATION = 700
const WIDTH = 375
const CARD_H = 56
const RADIUS = Math.round(28 / Math.tan(9.5 * Math.PI / 180))
const names = ['冷凍庫', 'ドリンク', '乾物棚', '冷蔵庫', '野菜室', '調味料', 'ストック']
const counts = [8, 12, 6, 24, 9, 16, 5]
const n = value => Number(value.toFixed(3))

export function wheelSvg(open = 1, labels = false) {
  const progress = Math.max(0, Math.min(1, open))
  const height = 56 + 280 * progress
  const stageWidth = WIDTH - 64 * progress
  // 中央カードを最後に描き、畳んだ時にも選択中のカードが最前面に残る。
  const slots = [-3, 3, -2, 2, -1, 1, 0]
  const cards = slots.map(slot => {
    const angle = slot * 19 * progress * Math.PI / 180
    const perspective = 460 / (460 + RADIUS * (1 - Math.cos(angle)))
    const xScale = perspective
    const yScale = Math.cos(angle) * perspective
    const width = stageWidth - 32
    const x = stageWidth / 2 - width * xScale / 2
    const y = height / 2 + RADIUS * Math.sin(angle) * perspective - CARD_H * yScale / 2
    const opacity = slot === 0 ? 1 : (1 - Math.abs(slot) / 4.4) * progress
    const selected = slot === 0
    const changeWidth = selected ? 72 * (1 - progress) : 0
    const badgeX = width - 62 - changeWidth
    const badgeHeight = selected ? 44 - 12 * progress : 32
    const id = slot === 0 ? 'card-selected' : `card-${slot < 0 ? 'above' : 'below'}-${Math.abs(slot)}`
    return `<g id="${id}" opacity="${n(opacity)}" transform="translate(${n(x)} ${n(y)}) scale(${n(xScale)} ${n(yScale)})">
  <rect id="${id}-surface" x="0.75" y="0.75" width="${n(width - 1.5)}" height="54.5" rx="12" fill="${selected ? '#eff6ff' : '#ffffff'}" stroke="${selected ? '#2563eb' : '#e2e8f0'}" stroke-width="1.5"/>
  <rect id="${id}-count" x="${n(badgeX)}" y="${n((56 - badgeHeight) / 2)}" width="48" height="${n(badgeHeight)}" rx="14" fill="${selected ? '#2563eb' : '#eef2f6'}"/>
  ${selected ? `<g id="change-control" opacity="${n(1 - progress)}"><rect x="${n(width - 76)}" y="12" width="62" height="32" rx="8" fill="#ffffff" stroke="#e2e8f0"/><path d="M ${n(width - 30)} 26 l 4 4 l 4 -4" fill="none" stroke="#64748b" stroke-width="1.5"/></g>` : ''}
  ${labels ? `<text x="14" y="33" fill="#1e293b" font-size="15" font-weight="800">${names[slot + 3]}</text><text x="${n(badgeX + 24)}" y="33" text-anchor="middle" fill="${selected ? '#ffffff' : '#64748b'}" font-size="14" font-weight="800">${counts[slot + 3]}</text>${selected ? `<text x="${n(width - 68)}" y="32" font-size="11" fill="#64748b" opacity="${n(1 - progress)}">変える</text>` : ''}` : ''}
</g>`
  }).join('\n')
  const rail = [
    '<path d="M 337 118 h 12 M 343 112 v 12" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round"/>',
    '<path d="M 336 163 h 14 M 336 168 h 14 M 336 173 h 14" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round"/>',
    '<path d="M 337 213 h 12 M 340 210 h 6 M 339 216 v 9 h 8 v -9" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/>',
  ].map((icon, index) => `<g id="rail-${['add', 'manage', 'remove'][index]}"><rect x="320" y="${96 + index * 50}" width="46" height="44" rx="10" fill="#ffffff" stroke="${index === 2 ? '#fecaca' : '#e2e8f0'}"/>${icon}</g>`).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="375" height="${n(height)}" viewBox="0 0 375 ${n(height)}">
<title>振り分けホイール 素材案</title>
<desc>既存UIを参考にした静止ベクター素材。動的な分類名と件数はRiveまたはアプリで設定する。</desc>
<g id="wheel-background"><rect width="375" height="${n(height)}" fill="#ffffff"/></g>
${cards}
<g id="selection-marker" opacity="${n(.5 * progress)}"><path d="M 0 ${n(height / 2 - 29)} H ${n(stageWidth)} M 0 ${n(height / 2 + 29)} H ${n(stageWidth)}" fill="none" stroke="#bfdbfe" stroke-width="1"/></g>
<g id="action-rail" opacity="${n(progress)}" transform="translate(0 ${n((height - 336) / 2)})"><rect x="311" width="64" height="336" fill="#f8fafc"/><path d="M 311 0 V 336" fill="none" stroke="#eef2f6"/>${rail}</g>
</svg>`
}
