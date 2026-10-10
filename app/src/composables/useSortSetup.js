// 並び替え（保管場所などでの振り分け）の進み具合と、振り分けの画面を開く操作。
// ホームの「並び替え」タイルと、はじめて使うときの大きなおすすめで共通（User決定 2026-10-04）。
// 名前の付いた並び替えのうち、いちばん振り分けが進んでいるもので判断する。
import { computed } from 'vue'
import { useConfig } from './useConfig.js'
import { showAxisAssign, axisAssignInitial } from './appMenuState.js'
import { can, denyMessage } from './useAuth.js'

export function useSortSetup() {
  const { config, setAxisName } = useConfig()

  // 名前の付いた並び替えごとの進み具合（在庫タブの並び替えカードのボタン・User決定 2026-10-10）
  const axesProgress = computed(() => {
    const hidden = new Set(config.hiddenItems ?? [])
    const items = (config.order ?? []).filter(n => !hidden.has(n))
    const names = config.axisNames ?? ['', '']
    const out = []
    for (const idx of [0, 1]) {
      if (!(names[idx] || '').trim()) continue
      const tags = (idx === 0 ? config.tagsA : config.tagsB) ?? {}
      const assigned = items.reduce((n, it) => n + (tags[it]?.length ? 1 : 0), 0)
      out.push({ idx, name: names[idx], assigned, total: items.length })
    }
    return out
  })
  const sortProgress = computed(() => {
    let best = null
    for (const a of axesProgress.value) if (!best || a.assigned > best.assigned) best = a
    const total = (config.order ?? []).filter(n => !new Set(config.hiddenItems ?? []).has(n)).length
    return { best, total }
  })
  /** 空いている並び替えの枠（0/1）。2つとも使っていれば -1 */
  const freeSlot = computed(() => {
    const names = config.axisNames ?? ['', '']
    if (!(names[0] || '').trim()) return 0
    if (!(names[1] || '').trim()) return 1
    return -1
  })
  // 'none' = まだ1つも振り分けていない / 'half' = 途中まで / 'done' = すべて振り分け済み / '' = 品目なし
  const sortStage = computed(() => {
    const { best, total } = sortProgress.value
    if (!total) return ''
    if (!best || best.assigned === 0) return 'none'
    return best.assigned < total ? 'half' : 'done'
  })

  /** 振り分けの画面を開く。並び替えがまだ無ければ名前（既定は「保管場所」）を決めてから */
  function openSort() {
    if (!can('sort')) { window.alert(denyMessage('sort')); return false }
    let idx = sortProgress.value.best?.idx
    if (idx == null) {
      const names = config.axisNames ?? ['', '']
      idx = (names[0] || '').trim() ? ((names[1] || '').trim() ? 0 : 1) : 0
      if (!(names[idx] || '').trim()) {
        const name = (window.prompt('並び替えの名前を入力（例：保管場所・仕入先）', '保管場所') || '').trim()
        if (!name) return false
        if (!setAxisName(idx, name)) { window.alert('その名前は既に使われています'); return false }
      }
    }
    axisAssignInitial.value = idx
    showAxisAssign.value = true
    return true
  }

  /** 決まった並び替えの振り分けの画面を開く */
  function openSortAxis(idx) {
    if (!can('sort')) { window.alert(denyMessage('sort')); return false }
    axisAssignInitial.value = idx
    showAxisAssign.value = true
    return true
  }

  /** 並び替えを1つ足して、その振り分けの画面を開く。name を渡さなければ名前を訊く */
  function addSortAxis(name = null) {
    if (!can('sort')) { window.alert(denyMessage('sort')); return false }
    const idx = freeSlot.value
    if (idx < 0) return false
    const n = (name ?? (window.prompt('並び替えの名前を入力（例：保管場所・仕入先）', '') || '')).trim()
    if (!n) return false
    if (!setAxisName(idx, n)) { window.alert('その名前は既に使われています'); return false }
    return openSortAxis(idx)
  }

  return { sortProgress, sortStage, axesProgress, freeSlot, openSort, openSortAxis, addSortAxis }
}
