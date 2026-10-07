/**
 * 役割と権限（段 2-3・User決定 2026-10-07。表は docs/proposals.md）。
 * **worker/src/permissions.js と同じ中身**にする（片方を変えたら両方を変える。テストで突き合わせる）。
 *
 * 役割: owner（店を登録した人）/ admin（管理者）/ shain（社員）/ arbeit（アルバイト）
 * 足し引き（人ごと・grants）: その役割に無い権限だけを足す
 */
export const ROLES = ['arbeit', 'shain', 'admin']
export const GRANT_KEYS = ['orderStart', 'orderFinish', 'stock', 'task', 'itemEdit']

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
  'item.admin':     '品目の削除・ファイルの取り込み・全品目の削除',
  sort:             '並び替え（振り分け）',
  orderSettings:    '発注日・締切・発注点',
  'task.create':    'やることを作る',
  'task.deleteOthers': '他の人のやることを消す',
  money:            '金額（単価・在庫金額・レポート）を見る',
  staff:            'スタッフの管理',
  monitor:          'ログイン中・作業時間などの見守り',
}

const ARBEIT = ['count', 'order.draft', 'move', 'item.add', 'task.complete']
const SHAIN = [...ARBEIT, 'stock.start', 'stock.finish', 'stock.discard', 'order.start', 'order.finish',
  'item.edit', 'task.create', 'task.deleteOthers', 'money']
const BASE = {
  arbeit: new Set(ARBEIT),
  shain:  new Set(SHAIN),
  admin:  new Set(Object.keys(PERMS)),
  owner:  new Set(Object.keys(PERMS)),
}
/** 足し引きの1つで増える権限 */
export const GRANT_PERMS = {
  orderStart:  ['order.start'],
  orderFinish: ['order.finish'],
  stock:       ['stock.start', 'stock.finish'],
  task:        ['task.create'],
  itemEdit:    ['item.edit', 'sort', 'orderSettings'],
}

export function normalizeGrants(g) {
  return Array.isArray(g) ? [...new Set(g.filter(k => GRANT_KEYS.includes(k)))] : []
}

/** その役割（＋足し引き）で perm ができるか */
export function can(role, grants, perm) {
  const base = BASE[role]
  if (!base) return false
  if (base.has(perm)) return true
  return normalizeGrants(grants).some(k => GRANT_PERMS[k].includes(perm))
}

/** 役割の既定に無い（＝足した）足し引きだけ */
export function extraGrants(role, grants) {
  return normalizeGrants(grants).filter(k => GRANT_PERMS[k].some(p => !BASE[role]?.has(p)))
}
