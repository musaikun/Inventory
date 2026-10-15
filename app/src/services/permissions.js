/**
 * 役割と権限（段 2-3・User決定 2026-10-07 → 2026-10-15 に作り替え）。
 * **worker/src/permissions.js と同じ中身**にする（片方を変えたら両方を変える。テストで突き合わせる）。
 *
 * 権限は人ごとに4つのまとまりのオン・オフ（User決定 2026-10-15）。社員・アルバイトは肩書き（表示）だけで、
 * できることは決めない。
 *   - inventory 在庫管理: 数える・入出庫・発注・棚卸の開始と完了・ルームを作る・並び替え・金額を見る
 *   - tasks     タスク管理: やることを作る
 *   - data      データの更新: 品目の取り込み・書き出し・品目の情報を直す・発注日と発注点
 *   - report    レポート・分析・証跡: レポート・過去の履歴・ほかのスタッフの使用履歴
 * 招待した人は在庫管理とタスク管理がオン（DEFAULT_GROUPS）。やることの完了の印は誰でも。
 * スタッフの管理（招待・権限の付与）と、全品目の削除は管理者（とオーナー）だけ（オン・オフにしない）。
 *
 * 役割: owner（店を登録した人）/ admin（管理者・店に1人）/ shain・arbeit（肩書き）
 * 保存の形: staff.grants_json = { v: 2, groups: [...] }。
 *   以前の形（足し引きの配列・または NULL）は役割から読み替える（できることは前と同じ）
 */
export const ROLES = ['arbeit', 'shain', 'admin']
export const GROUP_KEYS = ['inventory', 'tasks', 'data', 'report']
export const DEFAULT_GROUPS = ['inventory', 'tasks']

export const PERMS = {
  count:            '数える（ルームに参加）',
  'order.draft':    '発注数を入れる',
  move:             '入庫・出庫を入れる',
  'item.add':       '品目を足す',
  'task.complete':  'やることを完了する',
  'stock.start':    '棚卸を始める・中断・再開',
  'stock.finish':   '棚卸を完了する',
  'stock.discard':  '棚卸・発注を破棄する・戻す',
  'order.start':    '発注を始める',
  'order.finish':   '発注を完了する・業者へ書き出す',
  'item.edit':      '品目の情報を直す・写真・非表示',
  'item.admin':     '品目の取り込み・書き出し・削除',
  'item.purge':     '全品目の削除',
  sort:             '並び替え（振り分け）',
  orderSettings:    '発注日・締切・発注点',
  'task.create':    'やることを作る',
  'task.deleteOthers': '他の人のやることを消す（管理者だけ）',
  money:            '金額（単価・在庫金額）を見る',
  report:           'レポート・過去の履歴を見る',
  staff:            'スタッフの管理',
  monitor:          'ほかのスタッフの使用履歴（ログイン中・作業時間・やったこと）',
}

/** まとまりごとに増える権限 */
export const GROUP_PERMS = {
  inventory: ['count', 'order.draft', 'move', 'item.add', 'stock.start', 'stock.finish', 'stock.discard',
    'order.start', 'order.finish', 'sort', 'money'],
  tasks:     ['task.create'],
  data:      ['item.edit', 'item.admin', 'orderSettings'],
  report:    ['report', 'monitor'],
}
/** スタッフなら誰でも */
const ALWAYS = new Set(['task.complete'])
const ALL = new Set(Object.keys(PERMS))

/**
 * その人のまとまり。新しい形 { v: 2, groups } はそのまま、以前の形は役割と足し引きから読み替える
 * （以前の社員は全部、アルバイトは在庫管理＋足し引きの分）
 */
export function groupsOf(role, grants) {
  if (role === 'owner' || role === 'admin') return [...GROUP_KEYS]
  if (grants && !Array.isArray(grants) && grants.v === 2) {
    return GROUP_KEYS.filter(k => Array.isArray(grants.groups) && grants.groups.includes(k))
  }
  const old = Array.isArray(grants) ? grants : []
  if (role === 'shain') return [...GROUP_KEYS]
  const out = new Set(['inventory'])
  if (old.includes('task')) out.add('tasks')
  if (old.includes('itemEdit')) out.add('data')
  return GROUP_KEYS.filter(k => out.has(k))
}

/** 保存する形（知らないまとまりは捨てる） */
export function normalizeGroups(groups) {
  return { v: 2, groups: GROUP_KEYS.filter(k => Array.isArray(groups) && groups.includes(k)) }
}

/** その役割（＋まとまり）で perm ができるか */
export function can(role, grants, perm) {
  if (role === 'owner' || role === 'admin') return ALL.has(perm)
  if (!ROLES.includes(role)) return false
  if (ALWAYS.has(perm)) return true
  return groupsOf(role, grants).some(g => GROUP_PERMS[g].includes(perm))
}
