// 月のカレンダーのイベントの線: 週や月をまたいでも、どの線がどのイベントか分かること（User 2026-11-18）
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import JournalMonth from './JournalMonth.vue'

let app = null, host = null
async function mount(spans) {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(JournalMonth, { today: '2026-11-15', focus: '2026-11-15', info: () => ({ st: '', tags: [] }), spans }) })
  app.mount(host); await nextTick()
}
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })
const ev = (id, text, start, end) => ({ id, text, start, end, state: 'event', future: false })
const lines = id => [...host.querySelectorAll(`.jm-span.event[data-span="${id}"]`)]

// 2026年11月は1日が日曜。週: 1-7 / 8-14 / 15-21 / 22-28 / 29-
describe('JournalMonth — イベントの線', () => {
  it('名前は週ごとの線の頭に毎回出す。続きの週は「…名前」', async () => {
    await mount([ev('e1', 'YOASOBIコラボ', '2026-11-12', '2026-11-24')])
    const ls = lines('e1')
    expect(ls).toHaveLength(3)
    expect(ls.map(l => l.querySelector('.lb').textContent)).toEqual(['YOASOBIコラボ', '…YOASOBIコラボ', '…YOASOBIコラボ'])
  })

  it('終わりの週の線の終わりに「〜m/d」。途中の週には付けない', async () => {
    await mount([ev('e1', 'YOASOBIコラボ', '2026-11-12', '2026-11-24')])
    expect(lines('e1').map(l => l.querySelector('.end')?.textContent ?? '')).toEqual(['', '', '〜11/24'])
  })

  it('2日以上のイベントは、終わりの週に「〜m/d」と止め線。1日だけのものは名札だけ', async () => {
    await mount([ev('e2', '催事', '2026-11-02', '2026-11-04'), ev('e9', '試食会', '2026-11-05', '2026-11-05')])
    expect(lines('e2')[0].querySelector('.end').textContent).toBe('〜11/4')
    expect(lines('e2')[0].querySelector('.cap')).not.toBeNull()
    expect(lines('e9')[0].querySelector('.end')).toBeNull()
    expect(lines('e9')[0].querySelector('i')).toBeNull()
  })

  it('続きの週は「‹」と点線の札、次の週へ続くなら「›」', async () => {
    await mount([ev('e1', 'YOASOBIコラボ', '2026-11-12', '2026-11-24')])
    const [w1, w2] = lines('e1')
    expect(w1.querySelector('.lb.cont')).toBeNull()
    expect(w1.textContent).toContain('›')
    expect(w2.querySelector('.lb.cont')).not.toBeNull()
    expect(w2.textContent).toContain('‹')
  })

  it('終わりの週の線が1日ぶんしか無ければ付けない（入りきらない）', async () => {
    await mount([ev('e3', 'フェア', '2026-11-04', '2026-11-08')])
    const ls = lines('e3')
    expect(ls).toHaveLength(2)
    expect(ls.every(l => !l.querySelector('.end'))).toBe(true)
  })

  it('次の月へ続くものは、この月の最後の週に日付を付けない（終わりはこの月に無い）', async () => {
    await mount([ev('e4', 'パンどろぼう予約期間', '2026-11-15', '2026-12-20')])
    expect(lines('e4').every(l => !l.querySelector('.end'))).toBe(true)
  })
})

describe('JournalMonth — 入りきらない線', () => {
  // 11/15〜21 の週に10件
  const many = [
    ev('A', '忘年会予約受付', '2026-11-02', '2026-11-27'),
    ev('B', '年末フェア', '2026-11-10', '2026-11-20'),
    ev('G', '新人研修', '2026-11-15', '2026-11-18'),
    ev('E', '棚卸強化週間', '2026-11-16', '2026-11-21'),
    ev('H', '歳末セール', '2026-11-16', '2026-11-19'),
    ev('I', '仕入先フェア', '2026-11-17', '2026-11-17'),
    ev('D', '新メニュー告知', '2026-11-18', '2026-11-30'),
    ev('J', '産直市', '2026-11-18', '2026-11-21'),
    ev('K', '予約強化', '2026-11-19', '2026-11-24'),
    ev('L', '店内装飾', '2026-11-20', '2026-11-20'),
  ]
  const inWeek = id => lines(id).some(l => l.style.gridRow === '3')

  it('段が足りなければ、続いているだけのものから「ほか〇件」へ。その週に始まるものは先に線で出す', async () => {
    await mount(many)
    expect(inWeek('A')).toBe(false)            // 前の週から続き、この週に終わらない
    expect(inWeek('G')).toBe(true)
    const ev3 = [...host.querySelectorAll('.jm-span.event')].filter(l => l.style.gridRow === '3')
    expect(new Set(ev3.map(l => l.style.marginTop)).size).toBeLessThanOrEqual(3)   // 4段目は「ほか」
  })

  it('「ほか〇件」は件数が変わる日で区切る。押すとその期間の一覧、選ぶと @span', async () => {
    const spans = []
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp({ render: () => h(JournalMonth, { today: '2026-11-15', focus: '2026-11-15', info: () => ({ st: '', tags: [] }), spans: many, onSpan: id => spans.push(id) }) })
    app.mount(host); await nextTick()
    const more = [...host.querySelectorAll('.jm-more.ev')].filter(m => m.style.gridRow === '3')
    expect(more.length).toBeGreaterThan(1)
    expect(more[0].dataset.more).toBe('2026-11-15')
    expect(more[0].textContent).toMatch(/^ほか\d件/)
    more[0].click(); await nextTick()
    const items = [...host.querySelectorAll('.jm-mo-it')]
    expect(items.map(x => x.dataset.span)).toContain('A')
    items.find(x => x.dataset.span === 'A').click(); await nextTick()
    expect(spans).toEqual(['A'])
    expect(host.querySelector('.jm-mo')).toBeNull()
  })

  it('4件までなら「ほか」は出さない', async () => {
    await mount(many.slice(0, 4))
    expect(host.querySelector('.jm-more')).toBeNull()
  })
})
