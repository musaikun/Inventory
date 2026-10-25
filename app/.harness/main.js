import { createApp, h } from 'vue'
import '../src/style.css'
import { STORAGE_KEYS } from '../src/utils/storageKeys.js'
import { localDateKey } from '../src/utils/localDate.js'
const mode = new URLSearchParams(location.search).get('m') || 'full'
localStorage.clear()
const k = n => localDateKey(new Date(Date.now() + n * 86400_000))
const ago = n => new Date(Date.now() - n * 86400_000).toISOString()
localStorage.setItem('_device_name', '高木')
if (mode !== 'empty') {
  const items = [{ id: 'a', text: 'ガスの元栓' }, { id: 'b', text: 'ダスター漂白' }]
  const runs = {}
  for (let i = 1; i <= 20; i++) { const d = k(-i); if (i % 5) runs[`c1|${d}|22:00`] = { items: [], marks: { a: { s: 'done', by: '山田', at: ago(i) }, b: { s: 'done', by: '山田', at: ago(i) } } } }
  runs[`c2|${k(0)}|`] = { items: [], marks: { _: { s: 'done', by: '高木', at: ago(0) } } }
  localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify({ lists: [
    { id: 'c1', name: '🌙 退店チェック', items, repeat: 'daily', startDate: k(-30), dueTimes: ['22:00'], assign: 'person', assigneeId: 'u-yamada', assigneeName: '山田' },
    { id: 'c2', name: '🗑 ゴミ出し', items: [], repeat: 'daily', startDate: k(-30), dueTimes: [], assign: 'anyone' },
    { id: 'c3', name: '🌡 冷蔵庫の温度', items: [{ id: 'f', text: '冷蔵庫' }], repeat: 'daily', startDate: k(-30), dueTimes: ['10:00', '15:00', '21:00'], assign: 'anyone' },
  ], runs }))
}
const T = await import('../src/composables/useTasks.js')
if (mode === 'full') {
  T.addTask(k(0), '野菜の検品', null, '11:00')
  T.addTask(k(0), '製氷機フィルター交換', { mode: 'person', id: 'u-sato', name: '佐藤' })
  T.addTask(k(-2), '油の交換')
  T.addTask(k(0), 'テーブル配置（貸切）', null, '19:00')
  T.addTask(k(3), '酒屋の納品')
  T.addTask(k(0), 'エアコンの修理', null, null, { progress: 'doing' })
}
const { default: JournalPage } = await import('../src/components/JournalPage.vue')
createApp({ render: () => h('div', { style: 'max-width:600px;margin:0 auto;min-height:100vh' }, [h(JournalPage)]) }).mount('#app')
