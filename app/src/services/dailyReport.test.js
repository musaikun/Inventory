import { describe, it, expect } from 'vitest'
import { dailyReportText } from './dailyReport.js'

describe('日報の文字（User決定 2026-10-25）', () => {
  it('済みの数・やり残し（担当つき）・記録（棚卸は合計と中断）・メモ', () => {
    const at = Date.parse('2026-10-23T10:35:00'), end = Date.parse('2026-10-23T16:15:00')
    const text = dailyReportText({
      date: '2026-10-23', store: 'テスト店',
      tasks: [{ text: '野菜の検品', doneAt: 'x' }, { text: '製氷機フィルター交換', assigneeName: '佐藤' }],
      lists: [{ cl: { name: '退店チェック' }, complete: false, filled: 5, total: 6 }, { cl: { name: 'ゴミ出し' }, complete: true, filled: 1, total: 1 }],
      records: [{ kind: 'stock', title: '棚卸 完了 ・ 40品目', at, end, pauses: [{}], pauseMs: 20 * 60000 }, { kind: 'order', title: '発注 2社 5品目' }],
      note: '20時から貸切',
    })
    expect(text.split('\n')).toEqual([
      '【日報】10/23（金） テスト店',
      'やること 2/4 済み',
      '▼ やり残し',
      '・退店チェック 5/6',
      '・製氷機フィルター交換（佐藤）',
      '▼ 記録',
      '・棚卸 完了 ・ 40品目（合計 5時間40分 ・ 中断1回 20分）',
      '・発注 2社 5品目',
      '▼ メモ',
      '20時から貸切',
    ])
  })
  it('何もない日は見出しだけ', () => {
    expect(dailyReportText({ date: '2026-10-25' })).toBe('【日報】10/25（日）')
  })
})
