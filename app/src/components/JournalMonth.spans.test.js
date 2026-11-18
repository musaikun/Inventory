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

  it('3日以下のイベントには終わりの日付を付けない', async () => {
    await mount([ev('e2', '催事', '2026-11-02', '2026-11-04')])
    expect(lines('e2')[0].querySelector('.end')).toBeNull()
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
