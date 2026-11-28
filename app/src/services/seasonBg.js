/**
 * ホームの背景の月ごとの色とモチーフ（User決定 2026-11-28・モック https://claude.ai/artifact/NevPW7Y1BC9rKUUYu4ZwZQ）。
 * 輪（2本）の色を月に寄せ、モチーフは細い線画を少しだけ、1つずつ別の速さ・向きで動かす
 * （全部が一緒に動くとチープに見えるため）。行事ではなく、季節の自然のものだけ。
 *
 * - 月は日本の暦。南半球（緯度がマイナス）は6か月ずらし、季節の無い地域（緯度 ±15°以内）はモチーフを出さず今の色
 * - 月の終わりの3日は、次の月の色へ少しずつ寄せる（境目でパッと変えない）
 * - 純粋な関数だけ。描くのは HomeTop.vue
 */

export const DEFAULT_RING = ['#2563eb', '#22d3ee', '#34d399']

// 線画（20×20。線の属性は描くときに足す）
// 線の太さは絵の大きさによらず一定（大きな花火や雲が太く濃くならないように）
const LN = 'fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"'
const SHAPES = {
  snowdot: `<circle ${LN} cx="10" cy="10" r="3.2"/>`,
  ume: `<path ${LN} d="M10 3 C15.5 3 17.5 8.5 14.5 13 C12.5 16 7.5 16 5.5 13 C2.5 8.5 4.5 3 10 3 Z"/><circle ${LN} cx="10" cy="10" r="1.2" opacity=".6"/>`,
  bud: `<g ${LN}><circle cx="10" cy="6.5" r="2.6"/><circle cx="13.5" cy="10" r="2.6"/><circle cx="10" cy="13.5" r="2.6"/><circle cx="6.5" cy="10" r="2.6"/></g>`,
  sakura: `<path ${LN} d="M10 19 C4 14 4 6 8 2 L10 4.5 L12 2 C16 6 16 14 10 19 Z"/>`,
  leaf: `<path ${LN} d="M3 17 C3 8 9 2 18 2 C18 11 12 17 3 17 Z"/><path ${LN} d="M3 17 L14 6" opacity=".6"/>`,
  rain: `<path ${LN} d="M12 1 L8 19"/>`,
  star: `<path ${LN} d="M10 1 L11.4 8.6 L19 10 L11.4 11.4 L10 19 L8.6 11.4 L1 10 L8.6 8.6 Z"/>`,
  burst: Array.from({ length: 12 }, (_, i) => {
    const a = i * Math.PI / 6, c = Math.cos(a), s = Math.sin(a)
    return `<path ${LN} d="M${(10 + c * 4).toFixed(1)} ${(10 + s * 4).toFixed(1)} L${(10 + c * 9.5).toFixed(1)} ${(10 + s * 9.5).toFixed(1)}"/>`
  }).join(''),
  moon: `<path ${LN} d="M13 2.5 A8 8 0 1 0 17.5 15 A6.4 6.4 0 1 1 13 2.5 Z"/>`,
  susuki: `<path ${LN} d="M10 40 C10 28 11 18 14 8"/><path ${LN} d="M14 8 C11 7 10 4 11 1 M14 8 C16 6 17 3 16 1 M13.2 12 C10.5 11 9.6 8.5 10 6 M13.2 12 C15.5 10.8 16.4 8.3 16 6"/>`,
  momiji: `<path ${LN} d="M10 19 L10 13 M10 13 L3.5 14.5 L6 10.5 L1.5 7.5 L6.5 7 L5.5 2 L9 5 L10 1 L11 5 L14.5 2 L13.5 7 L18.5 7.5 L14 10.5 L16.5 14.5 Z"/>`,
  ginkgo: `<path ${LN} d="M10 19 L10 12.5"/><path ${LN} d="M10 12.5 C4 12.5 1 8 2.5 2.5 C6 4.5 9 4 10 6 C11 4 14 4.5 17.5 2.5 C19 8 16 12.5 10 12.5 Z"/>`,
  flake: `<g ${LN}><path d="M10 1 V19 M2.2 5.5 L17.8 14.5 M2.2 14.5 L17.8 5.5"/><path d="M8 3 L10 5 L12 3 M8 17 L10 15 L12 17" opacity=".7"/></g>`,
  // 初日の出: 太陽（輪郭と短い光）と、細い雲の線
  sun: `<circle ${LN} cx="10" cy="10" r="5.2"/><g ${LN} opacity=".7"><path d="M10 1.5 V3.2 M10 16.8 V18.5 M1.5 10 H3.2 M16.8 10 H18.5 M4 4 L5.2 5.2 M14.8 14.8 L16 16 M4 16 L5.2 14.8 M14.8 5.2 L16 4"/></g>`,
  cloud: `<path ${LN} d="M1 12 C5 9 8 9 11 11 C14 13 17 12 19 10"/>`,
}

// 月ごと（1〜12月）。layers: { s: 線画, kind, n, size:[最小,最大], col, dur:[最小,最大], at?: [[x%, y%], ...], tall? }
// kind: fall（落ちる）・rise（上がる）・rain（斜めに落ちる）・twinkle（瞬く）・burst（開いて消える）・sway（揺れる）・glow（光る）・drift（横へ流れる）・halo（後ろの光）
export const MONTHS = [
  { name: '初日の出', ring: ['#f59e0b', '#fb923c', '#fda4af'], layers: [
    { kind: 'halo', at: [[72, 70]] },
    { s: 'sun', kind: 'glow', size: [52, 52], col: '#f59e0b', at: [[65, 66]] },
    { s: 'cloud', kind: 'drift', n: 3, size: [70, 110], col: '#fb923c', dur: [48, 80], at: [[0, 58], [0, 74], [0, 84]] }] },
  { name: '梅', ring: ['#94a3b8', '#fda4af', '#f43f5e'], layers: [{ s: 'ume', kind: 'fall', n: 6, size: [16, 22], col: '#f43f5e', dur: [16, 26] }] },
  { name: '菜の花', ring: ['#65a30d', '#facc15', '#fde047'], layers: [{ s: 'bud', kind: 'rise', n: 7, size: [14, 20], col: '#ca8a04', dur: [14, 24] }] },
  { name: '桜', ring: ['#22d3ee', '#f9a8d4', '#fbcfe8'], layers: [{ s: 'sakura', kind: 'fall', n: 7, size: [17, 23], col: '#f472b6', dur: [15, 25] }] },
  { name: '若葉', ring: ['#0e7490', '#22c55e', '#86efac'], layers: [{ s: 'leaf', kind: 'fall', n: 5, size: [18, 24], col: '#16a34a', dur: [17, 27] }] },
  { name: '雨', ring: ['#6366f1', '#818cf8', '#c4b5fd'], layers: [{ s: 'rain', kind: 'rain', n: 12, size: [18, 28], col: '#6366f1', dur: [3.2, 5.5] }] },
  { name: '星', ring: ['#1e3a8a', '#3b82f6', '#93c5fd'], layers: [{ s: 'star', kind: 'twinkle', n: 8, size: [11, 18], col: '#f59e0b', dur: [3.5, 7] }] },
  { name: '花火', ring: ['#1d4ed8', '#0ea5e9', '#67e8f9'], layers: [{ s: 'burst', kind: 'burst', n: 4, size: [70, 110], col: ['#0ea5e9', '#f43f5e', '#f59e0b', '#22c55e'], dur: [7, 12] }] },
  { name: '月とすすき', ring: ['#0e7490', '#fbbf24', '#f59e0b'], layers: [
    { s: 'moon', kind: 'glow', size: [44, 44], col: '#f59e0b', at: [[72, 44]] },
    { s: 'susuki', kind: 'sway', n: 3, size: [36, 46], col: '#a16207', dur: [5, 8], at: [[6, 80], [16, 83], [80, 82]], tall: true }] },
  { name: '紅葉', ring: ['#0e7490', '#f97316', '#dc2626'], layers: [{ s: 'momiji', kind: 'fall', n: 6, size: [18, 24], col: '#dc2626', dur: [15, 25] }] },
  { name: '銀杏', ring: ['#0e7490', '#eab308', '#ca8a04'], layers: [{ s: 'ginkgo', kind: 'fall', n: 6, size: [18, 24], col: '#ca8a04', dur: [15, 25] }] },
  { name: '雪の結晶', ring: ['#94a3b8', '#bae6fd', '#e0f2fe'], layers: [
    { s: 'flake', kind: 'fall', n: 6, size: [15, 22], col: '#38bdf8', dur: [17, 28] },
    { s: 'star', kind: 'twinkle', n: 4, size: [9, 13], col: '#93c5fd', dur: [4, 7] }] },
]

/** 'YYYY-MM-DD' と緯度から、使う月（1〜12）。季節の無い地域は null */
export function seasonMonth(dateKey, lat = null) {
  const m = Number(String(dateKey).slice(5, 7))
  if (!(m >= 1 && m <= 12)) return null
  if (typeof lat === 'number' && Math.abs(lat) < 15) return null
  if (typeof lat === 'number' && lat < 0) return ((m + 5) % 12) + 1   // 南半球は季節が逆
  return m
}

const _hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const _toHex = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
export const mixColor = (a, b, t) => _toHex(_hex(a).map((v, i) => v + (_hex(b)[i] - v) * t))

/** 輪の色（3色）。月の終わりの3日は次の月の色へ少しずつ寄せる */
export function ringColors(dateKey, lat = null) {
  const m = seasonMonth(dateKey, lat)
  if (!m) return DEFAULT_RING
  const y = Number(dateKey.slice(0, 4)), d = Number(dateKey.slice(8, 10))
  const dim = new Date(y, Number(dateKey.slice(5, 7)), 0).getDate()
  const cur = MONTHS[m - 1].ring, next = MONTHS[m % 12].ring
  const left = dim - d   // 月末まであと何日
  if (left >= 3) return cur
  const t = (3 - left) / 4   // 3日前 0.25 → 末日 0.75
  return cur.map((c, i) => mixColor(c, next[i], t))
}

// 少しずつずらした値（同じ月は毎回同じ見た目にするため、乱数は使わない）
const seq = (i, a, b, m = 7) => a + ((i * 37 + 11) % m) / (m - 1) * (b - a)

/**
 * 描くモチーフの一覧。位置は親（ホームの背景）に対する %、動きの名前はクラス（k-fall など）で、
 * 速さ・遅れ・揺れ幅は style（CSS 変数・animation-duration・animation-delay）で渡す。
 * @returns {{ cls: string, style: object, svg?: string, w?: number, h?: number, vb?: string, col?: string }[]}
 */
export function seasonMotifs(dateKey, lat = null) {
  const m = seasonMonth(dateKey, lat)
  if (!m) return []
  const out = []
  MONTHS[m - 1].layers.forEach((ly, li) => {
    const n = ly.n ?? 1
    for (let i = 0; i < n; i++) {
      const k = i + li * 5
      const [s0, s1] = ly.size ?? [0, 0]
      const size = Math.round(seq(k, s0, s1))
      const [d0, d1] = ly.dur ?? [8, 8]
      const dur = `${seq(k, d0, d1, 5).toFixed(1)}s`, delay = `${(-seq(k * 3 + 1, 0, d1, 9)).toFixed(1)}s`
      const op = seq(k * 13 + 5, 0.5, 0.85, 5).toFixed(2)
      const col = Array.isArray(ly.col) ? ly.col[i % ly.col.length] : ly.col
      const x = seq(k * 5 + 2, 3, 90, 11).toFixed(1)
      const at = ly.at?.[i] ?? ly.at?.[0]
      let style = { '--op': op, animationDuration: dur, animationDelay: delay }
      if (ly.kind === 'fall') {
        const sw = Math.round(seq(k * 7 + 3, 16, 42, 5)) * (i % 2 ? 1 : -1)
        const r = Math.round(seq(k * 11 + 4, 90, 300, 7)) * (i % 3 ? 1 : -1)
        style = { ...style, left: `${x}%`, '--sw': `${sw}px`, '--sw2': `${-sw / 2}px`, '--r1': `${r / 2}deg`, '--r2': `${r}deg` }
      } else if (ly.kind === 'rise') {
        style = { ...style, left: `${x}%`, '--sw': `${i % 2 ? 22 : -22}px` }
      } else if (ly.kind === 'rain') {
        style = { ...style, left: `${x}%`, '--op': (op * 0.8).toFixed(2) }
      } else if (ly.kind === 'twinkle' || ly.kind === 'burst') {
        style = { ...style, left: `${x}%`, top: `${seq(k * 9 + 7, 30, 86, 13).toFixed(1)}%` }
      } else if (ly.kind === 'drift') {
        style = { ...style, top: `${at ? (ly.at[i]?.[1] ?? at[1]) : 60}%` }
      } else {
        // sway・glow・halo は決まった場所
        style = { ...style, left: `${at[0]}%`, top: `${at[1]}%` }
        if (ly.kind === 'glow' || ly.kind === 'halo') { delete style.animationDelay }
      }
      const item = { cls: `k-${ly.kind}`, style }
      if (ly.s) {
        item.svg = SHAPES[ly.s]
        item.w = size
        item.h = ly.tall ? size * 2 : size
        item.vb = `0 0 20 ${ly.tall ? 40 : 20}`
        item.col = col
      }
      out.push(item)
    }
  })
  return out
}
